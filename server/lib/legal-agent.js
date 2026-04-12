/**
 * Legal Expert Agent
 *
 * RAG-powered legal advisor that answers questions about data protection
 * regulations, analyzes DPA clauses, and drafts remediation language.
 *
 * Uses the legal knowledge base for retrieval-augmented generation.
 * Falls back to knowledge-base-only answers when no LLM is configured.
 */

const prisma = require('./prisma');
const { getArticlesForClause, searchArticles } = require('./legal-knowledge');
const { computeRiskSignals, getEnforcementActions, getGuidance } = require('./regulator-research');

// Import LLM helper from ai.js — gracefully handle if not available
let llmComplete;
try {
  const aiModule = require('./ai');
  llmComplete = aiModule.llmComplete;
} catch {
  llmComplete = null;
}

// If ai.js doesn't export llmComplete directly, build our own from the provider
if (!llmComplete) {
  const AI_PROVIDER = (process.env.AI_PROVIDER || '').toLowerCase();
  let llmClient = null;

  if (AI_PROVIDER === 'openai' && process.env.OPENAI_API_KEY) {
    try {
      const OpenAI = require('openai');
      llmClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    } catch {}
  } else if (AI_PROVIDER === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      llmClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    } catch {}
  }

  llmComplete = async function(systemPrompt, userPrompt) {
    if (!llmClient) return null;
    try {
      if (AI_PROVIDER === 'openai') {
        const resp = await llmClient.chat.completions.create({
          model: process.env.OPENAI_MODEL || 'gpt-4o',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          max_tokens: 3000, temperature: 0.2
        });
        return resp.choices[0]?.message?.content || null;
      }
      if (AI_PROVIDER === 'anthropic') {
        const resp = await llmClient.messages.create({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
          max_tokens: 3000, system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        });
        return resp.content[0]?.text || null;
      }
    } catch (err) {
      console.error('Legal Agent LLM error:', err.message);
    }
    return null;
  };
}

const SYSTEM_PROMPT = `You are an expert data protection legal advisor integrated into the Auleg DPA auditing platform. You have deep knowledge of:

- GDPR (EU), UK GDPR, CCPA/CPRA (California), LGPD (Brazil), POPIA (South Africa), DPDPA (India), PIPEDA (Canada)
- DPA clause analysis: audit rights, breach notification, data subject rights, subprocessor controls, security measures, data processing purpose, data retention, cross-border transfers, liability, termination
- Recent enforcement actions and regulatory guidance
- Contract drafting best practices for data processing agreements

When answering:
1. Be specific and cite relevant articles/regulations
2. Consider multi-jurisdiction implications when relevant
3. Provide actionable advice, not just theory
4. When drafting clause language, use formal legal style appropriate for contracts
5. Flag any areas where legal counsel should be consulted
6. Reference recent enforcement actions when they inform the answer

Format responses in markdown for readability.`;

/**
 * Retrieve relevant context from the legal knowledge base for RAG.
 */
async function retrieveContext(query) {
  const q = query.toLowerCase();
  const context = { articles: [], enforcements: [], guidance: [], riskSignals: null };

  // Detect clause types in the query
  const clauseMap = {
    'audit': 'audit_rights', 'audit right': 'audit_rights',
    'breach': 'breach_notification', 'notification': 'breach_notification', 'incident': 'breach_notification',
    'data subject': 'data_subject_rights', 'dsar': 'data_subject_rights', 'access request': 'data_subject_rights', 'right to': 'data_subject_rights',
    'sub-processor': 'subprocessor_controls', 'subprocessor': 'subprocessor_controls', 'sub processor': 'subprocessor_controls',
    'security': 'security_measures', 'encryption': 'security_measures', 'access control': 'security_measures',
    'purpose': 'data_processing_purpose', 'processing purpose': 'data_processing_purpose', 'legal basis': 'data_processing_purpose',
    'retention': 'data_retention', 'deletion': 'data_retention', 'erasure': 'data_retention',
    'transfer': 'cross_border_transfer', 'cross-border': 'cross_border_transfer', 'international': 'cross_border_transfer', 'scc': 'cross_border_transfer', 'schrems': 'cross_border_transfer',
    'liability': 'liability', 'indemnif': 'liability', 'compensation': 'liability', 'fine': 'liability',
    'termination': 'termination', 'end of contract': 'termination'
  };

  let detectedClause = null;
  for (const [keyword, clause] of Object.entries(clauseMap)) {
    if (q.includes(keyword)) {
      detectedClause = clause;
      break;
    }
  }

  // Detect regulation
  const regulationMap = {
    'gdpr': 'GDPR', 'ccpa': 'CCPA', 'cpra': 'CCPA', 'lgpd': 'LGPD',
    'popia': 'POPIA', 'dpdpa': 'DPDPA', 'pipeda': 'PIPEDA', 'uk gdpr': 'UK-GDPR',
    'california': 'CCPA', 'brazil': 'LGPD', 'south africa': 'POPIA', 'india': 'DPDPA', 'canada': 'PIPEDA'
  };

  let detectedRegulation = null;
  for (const [keyword, reg] of Object.entries(regulationMap)) {
    if (q.includes(keyword)) {
      detectedRegulation = reg;
      break;
    }
  }

  // Retrieve relevant articles
  if (detectedClause) {
    context.articles = await getArticlesForClause(detectedClause);
  }

  // For general DPA/risk queries without a specific clause, pull key articles
  if (!detectedClause && (q.includes('dpa') || q.includes('risk') || q.includes('good') || q.includes('contract') || q.includes('complian'))) {
    // Fetch the core DPA article (GDPR Art. 28) and related
    for (const clause of ['data_processing_purpose', 'breach_notification', 'subprocessor_controls', 'security_measures', 'audit_rights', 'data_subject_rights']) {
      const arts = await getArticlesForClause(clause);
      for (const art of arts.slice(0, 2)) {
        if (!context.articles.find(a => a.id === art.id)) {
          context.articles.push(art);
        }
      }
      if (context.articles.length >= 10) break;
    }
  }

  if (context.articles.length < 5) {
    const searched = await searchArticles(query);
    const existingIds = new Set(context.articles.map(a => a.id));
    for (const art of searched) {
      if (!existingIds.has(art.id)) context.articles.push(art);
      if (context.articles.length >= 10) break;
    }
  }

  // Retrieve relevant enforcement actions
  context.enforcements = await getEnforcementActions({
    limit: 5,
    regulation: detectedRegulation || undefined,
    clauseType: detectedClause || undefined
  });

  // Retrieve relevant guidance
  context.guidance = await getGuidance({
    limit: 5,
    regulation: detectedRegulation || undefined,
    clauseType: detectedClause || undefined
  });

  // Get current risk signals
  context.riskSignals = await computeRiskSignals();

  return { context, detectedClause, detectedRegulation };
}

/**
 * Build the RAG context string for the LLM prompt.
 */
function buildContextString(ragContext) {
  let contextStr = '';

  if (ragContext.articles.length > 0) {
    contextStr += '## Relevant Legal Articles\n\n';
    for (const art of ragContext.articles.slice(0, 8)) {
      const regCode = art.regulation?.code || 'Unknown';
      contextStr += `### ${regCode} Article ${art.articleNum}: ${art.title}\n`;
      contextStr += `${art.summary}\n`;
      contextStr += `**Relevance to DPA:** ${art.relevance}\n\n`;
    }
  }

  if (ragContext.enforcements.length > 0) {
    contextStr += '## Recent Enforcement Actions\n\n';
    for (const ea of ragContext.enforcements.slice(0, 4)) {
      const fineStr = ea.fineAmount ? `€${(ea.fineAmount / 1e6).toFixed(1)}M` : 'N/A';
      contextStr += `- **${ea.entity}** (${ea.authority}, ${ea.country}): ${fineStr} fine. ${ea.summary}\n`;
      contextStr += `  Impact: ${ea.impact}\n\n`;
    }
  }

  if (ragContext.guidance.length > 0) {
    contextStr += '## Regulatory Guidance\n\n';
    for (const rg of ragContext.guidance.slice(0, 4)) {
      contextStr += `- **${rg.authority}**: "${rg.title}"\n`;
      contextStr += `  ${rg.implications}\n\n`;
    }
  }

  return contextStr;
}

/**
 * Generate a pattern-based answer (fallback when no LLM is configured).
 */
function generateFallbackAnswer(query, ragResult) {
  const { context, detectedClause, detectedRegulation } = ragResult;
  let answer = '';

  if (context.articles.length > 0) {
    answer += `## Relevant Legal Framework\n\n`;
    for (const art of context.articles.slice(0, 5)) {
      const regCode = art.regulation?.code || 'Unknown';
      answer += `### ${regCode} Article ${art.articleNum} — ${art.title}\n`;
      answer += `${art.summary}\n\n`;
      answer += `**DPA Relevance:** ${art.relevance}\n\n`;
    }
  }

  if (context.enforcements.length > 0) {
    answer += `## Recent Enforcement Context\n\n`;
    answer += `Regulators have been active in this area:\n\n`;
    for (const ea of context.enforcements.slice(0, 3)) {
      const fineStr = ea.fineAmount ? `€${(ea.fineAmount / 1e6).toFixed(1)}M` : 'No fine';
      answer += `- **${ea.entity}** — ${ea.authority} (${ea.country}): ${fineStr}. ${ea.impact}\n`;
    }
    answer += '\n';
  }

  if (context.guidance.length > 0) {
    answer += `## Applicable Guidance\n\n`;
    for (const rg of context.guidance.slice(0, 3)) {
      answer += `- **${rg.authority}**: ${rg.title}\n  ${rg.implications}\n\n`;
    }
  }

  if (detectedClause) {
    const signal = context.riskSignals?.[detectedClause];
    if (signal && signal.riskMultiplier > 1.0) {
      answer += `## ⚠ Elevated Risk Signal\n\n`;
      answer += `The **${detectedClause.replace(/_/g, ' ')}** area has a risk multiplier of **${signal.riskMultiplier.toFixed(1)}x** based on ${signal.enforcementCount} recent enforcement action(s). Pay extra attention to this clause in your DPA.\n\n`;
    }
  }

  if (!answer) {
    answer = `I found limited specific information for your query. Here's what I can tell you:\n\n`;
    answer += `- The Auleg knowledge base covers **7 major data protection regulations** (GDPR, UK GDPR, CCPA/CPRA, LGPD, POPIA, DPDPA, PIPEDA)\n`;
    answer += `- Try asking about specific DPA clauses (e.g., "breach notification requirements") or regulations (e.g., "GDPR Article 28")\n`;
    answer += `- For clause-specific analysis, reference your audit results\n`;
  }

  answer += `\n---\n*Note: This analysis is generated from Auleg's legal knowledge base. For definitive legal advice, consult qualified legal counsel.*`;

  return answer;
}

/**
 * Main chat function — answers a legal question using RAG.
 */
async function chat(query, chatHistory = [], auditContext = null) {
  // 1. Retrieve relevant context
  const ragResult = await retrieveContext(query);
  const contextStr = buildContextString(ragResult.context);

  // 2. Build audit-specific context if provided
  let auditStr = '';
  if (auditContext) {
    if (auditContext.clauseScores) {
      auditStr += '\n## Current Audit Context\n\n';
      auditStr += `Contract: ${auditContext.contractName || 'Unknown'}\n`;
      auditStr += `Risk Score: ${auditContext.riskScore || 'N/A'}\n`;
      auditStr += `Clause Scores:\n`;
      for (const [clause, score] of Object.entries(auditContext.clauseScores)) {
        auditStr += `- ${clause.replace(/_/g, ' ')}: ${score}/100\n`;
      }
      auditStr += '\n';
    }
  }

  // 3. Try LLM-powered response
  if (llmComplete) {
    const historyStr = chatHistory.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n');

    const userPrompt = `${contextStr}${auditStr}${historyStr ? `\n## Conversation History\n${historyStr}\n\n` : ''}## User Question\n${query}`;

    const llmResponse = await llmComplete(SYSTEM_PROMPT, userPrompt);
    if (llmResponse) {
      return {
        answer: llmResponse,
        sources: {
          articles: ragResult.context.articles.slice(0, 5).map(a => ({
            regulation: a.regulation?.code,
            article: a.articleNum,
            title: a.title
          })),
          enforcements: ragResult.context.enforcements.slice(0, 3).map(e => ({
            entity: e.entity,
            authority: e.authority,
            fine: e.fineAmount
          })),
          guidance: ragResult.context.guidance.slice(0, 3).map(g => ({
            authority: g.authority,
            title: g.title
          }))
        },
        detectedClause: ragResult.detectedClause,
        detectedRegulation: ragResult.detectedRegulation,
        provider: process.env.AI_PROVIDER || 'llm'
      };
    }
  }

  // 4. Fallback to pattern-based response
  const fallback = generateFallbackAnswer(query, ragResult);
  return {
    answer: fallback,
    sources: {
      articles: ragResult.context.articles.slice(0, 5).map(a => ({
        regulation: a.regulation?.code,
        article: a.articleNum,
        title: a.title
      })),
      enforcements: ragResult.context.enforcements.slice(0, 3).map(e => ({
        entity: e.entity,
        authority: e.authority,
        fine: e.fineAmount
      })),
      guidance: ragResult.context.guidance.slice(0, 3).map(g => ({
        authority: g.authority,
        title: g.title
      }))
    },
    detectedClause: ragResult.detectedClause,
    detectedRegulation: ragResult.detectedRegulation,
    provider: 'knowledge-base'
  };
}

/**
 * Draft remediation clause language for a specific gap.
 */
async function draftClause(clauseType, regulation = 'GDPR', currentLanguage = '') {
  const articles = await getArticlesForClause(clauseType);
  const relevantArticles = articles.filter(a => a.regulation?.code === regulation || !regulation);
  const enforcements = await getEnforcementActions({ clauseType, limit: 3 });

  const contextStr = relevantArticles.slice(0, 5).map(a =>
    `${a.regulation?.code} Article ${a.articleNum}: ${a.summary}\nBest practice: ${a.relevance}`
  ).join('\n\n');

  const enforcementStr = enforcements.map(e =>
    `${e.entity} (${e.authority}): ${e.impact}`
  ).join('\n');

  if (llmComplete) {
    const systemPrompt = `You are a data protection contract drafting expert. Draft formal, legally precise DPA clause language. The clause should be ready to insert into a Data Processing Agreement. Use numbered sub-clauses. Reference specific regulatory requirements. Consider recent enforcement trends.`;

    const userPrompt = `Draft a comprehensive ${clauseType.replace(/_/g, ' ')} clause for a DPA.

Regulation context: ${regulation}

Relevant articles:
${contextStr}

Recent enforcement trends:
${enforcementStr}

${currentLanguage ? `Current clause language (needs improvement):\n${currentLanguage}\n\nImprove this existing language while maintaining its structure.` : 'Draft a new clause from scratch.'}`;

    const response = await llmComplete(systemPrompt, userPrompt);
    if (response) return { clause: response, regulation, sources: relevantArticles.slice(0, 3).map(a => `${a.regulation?.code} Art. ${a.articleNum}`), provider: 'llm' };
  }

  // Fallback: template-based drafting
  const templates = {
    audit_rights: `**Audit Rights**\n\n1. The Processor shall make available to the Controller all information necessary to demonstrate compliance with this Agreement and applicable data protection law.\n\n2. The Controller shall have the right to conduct audits, including inspections, of the Processor's data processing activities, either directly or through an appointed third-party auditor, upon not less than thirty (30) days' prior written notice.\n\n3. The Processor shall cooperate fully with such audits and provide access to relevant premises, systems, records, and personnel.\n\n4. Such audits shall be limited to once per calendar year unless required by regulatory authority or in response to a data breach.\n\n5. The Processor shall bear its own costs relating to audit facilitation. The Controller shall bear the costs of external auditors.`,
    breach_notification: `**Data Breach Notification**\n\n1. The Processor shall notify the Controller of any Personal Data Breach without undue delay and in any event no later than twenty-four (24) hours after becoming aware of such breach.\n\n2. Such notification shall include:\n   (a) the nature of the breach including, where possible, the categories and approximate number of Data Subjects concerned;\n   (b) the likely consequences of the breach;\n   (c) the measures taken or proposed to address the breach;\n   (d) a single point of contact for further communications.\n\n3. The Processor shall cooperate fully with the Controller in managing the breach response and any regulatory notifications required under Article 33 GDPR.\n\n4. The Processor shall document all Personal Data Breaches, including facts, effects, and remedial actions taken.`,
    cross_border_transfer: `**International Data Transfers**\n\n1. The Processor shall not transfer Personal Data to any country outside the European Economic Area without the prior written consent of the Controller.\n\n2. Where such transfer is authorized, the Processor shall ensure appropriate safeguards are in place, including:\n   (a) Standard Contractual Clauses (Module 2 or 3 as applicable);\n   (b) A documented Transfer Impact Assessment;\n   (c) Supplementary technical measures (encryption in transit and at rest);\n   (d) Supplementary organizational measures (access restrictions, data compartmentalization).\n\n3. The Processor shall maintain a register of all international transfers, specifying destination country, legal basis, and safeguards employed.\n\n4. The Processor shall promptly notify the Controller of any changes in the laws of the destination country that may affect the adequacy of safeguards.`,
    subprocessor_controls: `**Sub-processor Governance**\n\n1. The Processor shall not engage any sub-processor without prior specific or general written authorization of the Controller.\n\n2. Where general authorization is given, the Processor shall:\n   (a) maintain a current list of all sub-processors;\n   (b) notify the Controller of any intended changes at least thirty (30) days in advance;\n   (c) afford the Controller the opportunity to object to such changes within fourteen (14) days of notification.\n\n3. The Processor shall impose equivalent data protection obligations on each sub-processor by way of contract.\n\n4. The Processor shall remain fully liable to the Controller for the performance of each sub-processor's obligations.`,
    security_measures: `**Technical and Organizational Security Measures**\n\n1. The Processor shall implement and maintain appropriate technical and organizational measures to ensure a level of security appropriate to the risk, including:\n   (a) encryption of personal data at rest (AES-256) and in transit (TLS 1.3);\n   (b) role-based access controls with principle of least privilege;\n   (c) multi-factor authentication for all systems processing personal data;\n   (d) regular penetration testing (at least annually);\n   (e) vulnerability management and patching within defined SLAs;\n   (f) documented incident response procedures;\n   (g) business continuity and disaster recovery capabilities.\n\n2. The Processor shall maintain SOC 2 Type II certification or equivalent and provide evidence upon request.\n\n3. The Processor shall conduct regular employee security awareness training.`
  };

  const template = templates[clauseType] || `**${clauseType.replace(/_/g, ' ')}**\n\n[Clause template not available for this type. Please use the LLM-powered drafting by configuring AI_PROVIDER.]`;

  return {
    clause: template,
    regulation,
    sources: relevantArticles.slice(0, 3).map(a => `${a.regulation?.code} Art. ${a.articleNum}`),
    provider: 'template'
  };
}

module.exports = {
  chat,
  draftClause,
  retrieveContext
};
