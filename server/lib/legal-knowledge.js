/**
 * Legal Knowledge Base — Law Awareness Engine
 * 
 * Comprehensive database of data protection regulations worldwide.
 * Provides multi-jurisdiction coverage for DPA auditing.
 */

const prisma = require('./prisma');

// ─── Regulation Seed Data ─────────────────────────────
const REGULATIONS = [
  {
    code: 'GDPR',
    name: 'General Data Protection Regulation',
    jurisdiction: 'EU',
    effectiveDate: new Date('2018-05-25'),
    lastAmended: new Date('2024-03-15'),
    summary: 'The EU\'s comprehensive data protection law governing the processing of personal data of individuals in the European Union.',
    url: 'https://eur-lex.europa.eu/eli/reg/2016/679/oj',
    articles: [
      { articleNum: '5', title: 'Principles of Processing', content: 'Personal data shall be processed lawfully, fairly and in a transparent manner. It must be collected for specified, explicit and legitimate purposes. Data must be adequate, relevant, limited, accurate, kept no longer than necessary, and processed securely.', summary: 'Core data processing principles: lawfulness, purpose limitation, data minimization, accuracy, storage limitation, integrity.', relevance: 'DPA must establish these principles as the foundation of the data processing relationship.', relatedClauses: 'data_processing_purpose,data_retention' },
      { articleNum: '6', title: 'Lawfulness of Processing', content: 'Processing is lawful only if at least one legal basis applies: consent, contractual necessity, legal obligation, vital interests, public interest, or legitimate interests.', summary: 'Six legal bases for processing personal data.', relevance: 'DPA must specify the legal basis for each processing activity.', relatedClauses: 'data_processing_purpose' },
      { articleNum: '13-14', title: 'Information to Data Subjects', content: 'Controllers must provide data subjects with information about processing at the time of collection, including identity of controller, purposes, legal basis, recipients, retention periods, and rights.', summary: 'Transparency requirements — what data subjects must be told.', relevance: 'DPA should ensure processor assists controller in meeting transparency obligations.', relatedClauses: 'data_subject_rights' },
      { articleNum: '15-22', title: 'Data Subject Rights', content: 'Data subjects have rights to access, rectification, erasure, restriction, portability, and objection. These must be fulfilled within one month.', summary: 'Full set of data subject rights under GDPR.', relevance: 'DPA must include processor obligations to assist controller in fulfilling these rights.', relatedClauses: 'data_subject_rights' },
      { articleNum: '25', title: 'Data Protection by Design and Default', content: 'Controllers must implement appropriate technical and organisational measures designed to implement data-protection principles, such as data minimisation, both at the time of determination of means and during processing.', summary: 'Privacy must be built into systems from the start.', relevance: 'DPA should require processor to implement privacy by design principles.', relatedClauses: 'security_measures' },
      { articleNum: '28', title: 'Processor Obligations', content: 'Controller must use only processors providing sufficient guarantees. Processing must be governed by a contract setting out subject-matter, duration, nature and purpose, type of data, categories of data subjects, and controller obligations and rights. Processor must: process only on documented instructions, ensure confidentiality, implement Article 32 security, respect sub-processing conditions, assist with data subject rights, assist with security obligations, delete or return data after services end, make available information to demonstrate compliance.', summary: 'The core article governing DPAs — defines all mandatory processor contract provisions.', relevance: 'This is the primary article that DPA auditing validates. Every clause in the audit maps to a requirement here.', relatedClauses: 'audit_rights,subprocessor_controls,data_subject_rights,security_measures,data_processing_purpose,termination' },
      { articleNum: '32', title: 'Security of Processing', content: 'Controller and processor must implement appropriate technical and organisational measures including pseudonymisation, encryption, confidentiality/integrity/availability, resilience, restoration capability, and regular testing. Risk-appropriate security considering state of art, costs, nature/scope/context/purposes, and risk severity.', summary: 'Security requirements — encryption, access controls, testing, resilience.', relevance: 'DPA must specify security measures the processor will implement.', relatedClauses: 'security_measures' },
      { articleNum: '33', title: 'Breach Notification to Authority', content: 'Controller must notify supervisory authority within 72 hours of becoming aware of a personal data breach, unless unlikely to result in risk to individuals. Must describe nature of breach, categories and approximate number of data subjects, likely consequences, and measures taken.', summary: 'Mandatory 72-hour breach notification to regulators.', relevance: 'DPA must require processor to notify controller of breaches without undue delay to enable compliance with this obligation.', relatedClauses: 'breach_notification' },
      { articleNum: '34', title: 'Breach Notification to Data Subjects', content: 'When breach is likely to result in high risk to rights and freedoms, controller must communicate it to data subjects without undue delay, describing nature and recommended measures.', summary: 'Notifying affected individuals of high-risk breaches.', relevance: 'DPA should address processor cooperation in data subject notification scenarios.', relatedClauses: 'breach_notification' },
      { articleNum: '44-49', title: 'International Transfers', content: 'Transfer of personal data to third countries may only take place if adequate safeguards exist: adequacy decision, standard contractual clauses, binding corporate rules, or specific derogations. Transfer impact assessments may be required.', summary: 'Rules for transferring data outside the EU.', relevance: 'DPA must address cross-border data flows and required safeguards.', relatedClauses: 'cross_border_transfer' },
      { articleNum: '82', title: 'Right to Compensation and Liability', content: 'Any person who has suffered material or non-material damage as a result of infringement has right to compensation from controller or processor. Controller involved in processing is liable for damage caused; processor liable only where it has not complied with obligations specifically directed to processors or has acted outside/contrary to lawful instructions.', summary: 'Liability framework — controller and processor compensation obligations.', relevance: 'DPA must define liability allocation between controller and processor.', relatedClauses: 'liability' },
      { articleNum: '83', title: 'Administrative Fines', content: 'Infringements can result in fines up to €20 million or 4% of worldwide annual turnover. Factors include nature/gravity/duration, intentional character, mitigation measures, degree of responsibility, history, cooperation, categories of data, and manner of discovery.', summary: 'Fine calculation framework — up to €20M or 4% global turnover.', relevance: 'Establishes the financial risk context for poor DPA compliance.', relatedClauses: 'liability' }
    ]
  },
  {
    code: 'CCPA',
    name: 'California Consumer Privacy Act (as amended by CPRA)',
    jurisdiction: 'US-CA',
    effectiveDate: new Date('2020-01-01'),
    lastAmended: new Date('2023-01-01'),
    summary: 'California\'s comprehensive privacy law giving consumers rights over their personal information and imposing obligations on businesses that collect it.',
    url: 'https://oag.ca.gov/privacy/ccpa',
    articles: [
      { articleNum: '1798.100', title: 'Consumer Right to Know', content: 'Consumers have the right to know what personal information is being collected and how it is used, including categories and specific pieces of information collected.', summary: 'Right to know what data is collected and why.', relevance: 'Service provider agreements must enable response to consumer requests.', relatedClauses: 'data_subject_rights,data_processing_purpose' },
      { articleNum: '1798.105', title: 'Right to Delete', content: 'Consumers can request deletion of personal information. Business must delete and direct service providers to delete.', summary: 'Consumer deletion rights — similar to GDPR right to erasure.', relevance: 'DPA must include service provider deletion obligations.', relatedClauses: 'data_subject_rights,data_retention' },
      { articleNum: '1798.110', title: 'Right to Know Specifics', content: 'Consumer can request categories of information, sources, purposes, and categories of third parties with whom information is shared.', summary: 'Detailed transparency obligations about data flows.', relevance: 'DPA should track all data sharing with service providers.', relatedClauses: 'data_processing_purpose,subprocessor_controls' },
      { articleNum: '1798.140(ag)', title: 'Service Provider Definition', content: 'A person that processes personal information on behalf of a business pursuant to a written contract. Cannot sell or share data, retain/use/disclose outside the direct business relationship.', summary: 'CCPA equivalent of GDPR processor — service provider definition.', relevance: 'Core DPA requirement — must establish service provider relationship with restrictions.', relatedClauses: 'data_processing_purpose,subprocessor_controls' },
      { articleNum: '1798.150', title: 'Private Right of Action', content: 'Consumers can bring civil action for data breaches involving non-encrypted/non-redacted personal information. Statutory damages of $100-$750 per consumer per incident or actual damages.', summary: 'Consumers can sue for data breaches — $100-$750 per person per incident.', relevance: 'DPA security measures directly affect breach liability exposure.', relatedClauses: 'security_measures,breach_notification,liability' },
      { articleNum: '1798.199.40-95', title: 'CPRA Amendments', content: 'Created California Privacy Protection Agency (CPPA). Added right to correction, expanded opt-out rights, introduced data minimization, purpose limitation, and special categories. Contractor and service provider distinctions.', summary: 'CPRA strengthened CCPA with new rights and enforcement.', relevance: 'DPA must now address expanded obligations under CPRA amendments.', relatedClauses: 'data_subject_rights,data_processing_purpose,security_measures' }
    ]
  },
  {
    code: 'LGPD',
    name: 'Lei Geral de Proteção de Dados',
    jurisdiction: 'Brazil',
    effectiveDate: new Date('2020-09-18'),
    lastAmended: new Date('2023-06-01'),
    summary: 'Brazil\'s comprehensive data protection law modeled on GDPR, governing processing of personal data of individuals in Brazil.',
    url: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm',
    articles: [
      { articleNum: '7', title: 'Legal Bases for Processing', content: 'Processing may only occur with: consent, legal obligation, public administration, research, contract execution, exercise of rights, life protection, health, legitimate interest, or credit protection.', summary: 'Ten legal bases for processing (broader than GDPR\'s six).', relevance: 'Brazilian DPAs must specify applicable legal basis from this broader list.', relatedClauses: 'data_processing_purpose' },
      { articleNum: '18', title: 'Data Subject Rights', content: 'Data subjects have rights to confirmation of processing, access, correction, anonymization, portability, deletion, information about sharing, consent management, and review of automated decisions.', summary: 'Comprehensive data subject rights similar to GDPR.', relevance: 'DPA must ensure processor facilitates exercise of these rights.', relatedClauses: 'data_subject_rights' },
      { articleNum: '33', title: 'International Transfer', content: 'International data transfer permitted only to countries with adequate protection, via standard contractual clauses, binding corporate rules, or specific legal grounds specified by ANPD.', summary: 'Cross-border transfer rules similar to GDPR Chapter V.', relevance: 'Brazil-related DPAs must address transfer safeguards.', relatedClauses: 'cross_border_transfer' },
      { articleNum: '46', title: 'Security Measures', content: 'Processing agents must adopt security measures to protect personal data from unauthorized access, accidental or unlawful destruction, loss, alteration, or any form of improper processing.', summary: 'Security requirements for processors.', relevance: 'DPA must specify security measures for Brazilian data.', relatedClauses: 'security_measures' },
      { articleNum: '48', title: 'Incident Communication', content: 'Controller must communicate to ANPD and data subject the occurrence of a security incident that may create risk or relevant damage within a reasonable time.', summary: 'Breach notification to authority and data subjects.', relevance: 'DPA must include incident notification obligations.', relatedClauses: 'breach_notification' },
      { articleNum: '52', title: 'Administrative Sanctions', content: 'Sanctions include warnings, fines up to 2% of revenue (max R$50M per infraction), daily fines, publication of infraction, blocking/deletion of data, and suspension/prohibition of processing.', summary: 'Fines up to 2% of revenue or R$50 million per infraction.', relevance: 'Establishes financial risk context for LGPD compliance.', relatedClauses: 'liability' }
    ]
  },
  {
    code: 'POPIA',
    name: 'Protection of Personal Information Act',
    jurisdiction: 'South Africa',
    effectiveDate: new Date('2021-07-01'),
    lastAmended: new Date('2021-07-01'),
    summary: 'South Africa\'s data protection law setting conditions for lawful processing of personal information.',
    url: 'https://popia.co.za/',
    articles: [
      { articleNum: '19', title: 'Security Measures', content: 'Responsible party must secure integrity and confidentiality of personal information by taking appropriate, reasonable technical and organisational measures.', summary: 'Security obligation for data controllers (responsible parties).', relevance: 'DPA must specify security standards for South African data.', relatedClauses: 'security_measures' },
      { articleNum: '20', title: 'Information Officer Notification', content: 'Where there are reasonable grounds to believe that personal information has been accessed or acquired by unauthorized person, responsible party must notify Information Regulator and data subject as soon as reasonably possible.', summary: 'Breach notification to Information Regulator and individuals.', relevance: 'DPA must include prompt breach notification provisions.', relatedClauses: 'breach_notification' },
      { articleNum: '21', title: 'Operator Processing', content: 'Responsible party must ensure operator processes information only with knowledge or authorization, treats it as confidential, and the responsible party must establish measures via written contract.', summary: 'POPIA equivalent of GDPR Article 28 — processor contract requirements.', relevance: 'Core provision governing DPAs under South African law.', relatedClauses: 'data_processing_purpose,security_measures,subprocessor_controls' },
      { articleNum: '72', title: 'International Transfer', content: 'Personal information may only be transferred to a foreign country if that country has adequate protection, the subject consents, transfer is necessary for contractual performance, or binding corporate rules apply.', summary: 'Cross-border transfer conditions.', relevance: 'DPA for South African organizations must address transfer safeguards.', relatedClauses: 'cross_border_transfer' }
    ]
  },
  {
    code: 'DPDPA',
    name: 'Digital Personal Data Protection Act',
    jurisdiction: 'India',
    effectiveDate: new Date('2023-08-11'),
    lastAmended: new Date('2025-01-01'),
    summary: 'India\'s comprehensive data protection legislation governing digital personal data processing.',
    url: 'https://www.meity.gov.in/data-protection-framework',
    articles: [
      { articleNum: '4', title: 'Lawful Processing', content: 'Processing is lawful only for lawful purposes with prior consent of data principal, or for certain legitimate uses.', summary: 'Consent-based processing with specified legitimate uses.', relevance: 'Indian DPAs must establish clear consent or legitimate use basis.', relatedClauses: 'data_processing_purpose' },
      { articleNum: '6', title: 'Consent Requirements', content: 'Consent must be free, specific, informed, unconditional, and unambiguous. Must be limited to personal data necessary for specified purpose.', summary: 'High standard for valid consent — similar to GDPR.', relevance: 'DPA must reflect consent requirements in processing terms.', relatedClauses: 'data_processing_purpose' },
      { articleNum: '8', title: 'Obligations of Data Fiduciary', content: 'Data fiduciary must ensure completeness, accuracy, and consistency; implement appropriate security; notify breach to Board and data principal; erase data no longer needed.', summary: 'Controller obligations including accuracy, security, breach notification, and erasure.', relevance: 'DPA must cover data fiduciary obligations passed to processor.', relatedClauses: 'security_measures,breach_notification,data_retention' },
      { articleNum: '16', title: 'Cross-Border Transfer', content: 'Central Government may restrict transfer of personal data to certain countries by notification.', summary: 'Government-controlled transfer restrictions — blocklist approach.', relevance: 'DPA must comply with any notified transfer restrictions.', relatedClauses: 'cross_border_transfer' },
      { articleNum: '33', title: 'Penalties', content: 'Penalties up to ₹250 crore (approximately $30 million) for significant data protection breaches.', summary: 'Fines up to approximately $30 million.', relevance: 'Significant financial penalties increase DPA compliance importance.', relatedClauses: 'liability' }
    ]
  },
  {
    code: 'PIPEDA',
    name: 'Personal Information Protection and Electronic Documents Act',
    jurisdiction: 'Canada',
    effectiveDate: new Date('2001-01-01'),
    lastAmended: new Date('2024-06-01'),
    summary: 'Canada\'s federal privacy law governing how private-sector organizations collect, use, and disclose personal information in commercial activities.',
    url: 'https://laws-lois.justice.gc.ca/eng/acts/P-8.6/',
    articles: [
      { articleNum: 'Principle 4.1', title: 'Accountability', content: 'An organization is responsible for personal information under its control. It must designate an individual responsible for compliance and protect data transferred to third parties via contractual or other means.', summary: 'Organizations must ensure third-party processors protect data via contracts.', relevance: 'Direct mandate for DPAs when using Canadian data.', relatedClauses: 'data_processing_purpose,subprocessor_controls' },
      { articleNum: 'Principle 4.5', title: 'Limiting Use, Disclosure, and Retention', content: 'Personal information shall not be used or disclosed for purposes other than those for which it was collected. Information shall be retained only as long as necessary.', summary: 'Purpose limitation and retention periods.', relevance: 'DPA must specify purposes and retention limits.', relatedClauses: 'data_processing_purpose,data_retention' },
      { articleNum: 'Principle 4.7', title: 'Safeguards', content: 'Personal information shall be protected by security safeguards appropriate to the sensitivity of the information.', summary: 'Proportionate security based on data sensitivity.', relevance: 'DPA must define appropriate security measures.', relatedClauses: 'security_measures' },
      { articleNum: '10.1', title: 'Breach Notification', content: 'Organization must report to Privacy Commissioner and notify affected individuals of any breach of security safeguards involving personal information that creates a real risk of significant harm.', summary: 'Mandatory breach reporting to Commissioner and individuals.', relevance: 'DPA must enable processor to support breach notification obligations.', relatedClauses: 'breach_notification' }
    ]
  },
  {
    code: 'UK-GDPR',
    name: 'UK General Data Protection Regulation',
    jurisdiction: 'UK',
    effectiveDate: new Date('2021-01-01'),
    lastAmended: new Date('2025-03-01'),
    summary: 'The UK\'s retained version of GDPR post-Brexit, with modifications including the UK International Data Transfer Agreement replacing EU SCCs.',
    url: 'https://www.legislation.gov.uk/eur/2016/679',
    articles: [
      { articleNum: '28', title: 'Processor Obligations (UK)', content: 'Mirrors EU GDPR Article 28 with UK-specific modifications. Controller must use processors with sufficient guarantees. Written contract required with specified terms.', summary: 'UK equivalent of EU GDPR processor contract requirements.', relevance: 'UK-specific DPAs must comply with UK GDPR\'s version of Article 28.', relatedClauses: 'audit_rights,subprocessor_controls,data_subject_rights,security_measures' },
      { articleNum: 'UK IDTA', title: 'UK International Data Transfer Agreement', content: 'The UK\'s alternative to EU SCCs for international data transfers. Must be used for transfers from UK to countries without adequacy status.', summary: 'UK-specific mechanism for international data transfers.', relevance: 'DPAs involving UK data must use UK IDTA instead of EU SCCs.', relatedClauses: 'cross_border_transfer' }
    ]
  }
];

// ─── Enforcement Seed Data ────────────────────────────
const ENFORCEMENT_ACTIONS = [
  { authority: 'DPC', country: 'Ireland', date: new Date('2023-05-22'), entity: 'Meta Platforms Ireland', fineAmount: 1200000000, regulation: 'GDPR', articles: '44-49', summary: 'Record €1.2 billion fine for systematic transfer of EU user data to the US without adequate safeguards following the Schrems II ruling. DPC ordered Meta to suspend data transfers within 5 months.', impact: 'Cross-border transfer clauses must now include Transfer Impact Assessments (TIAs) and supplementary measures. Standard Contractual Clauses alone may be insufficient.', clauseImpact: 'cross_border_transfer', severity: 'critical' },
  { authority: 'CNIL', country: 'France', date: new Date('2024-01-10'), entity: 'Criteo', fineAmount: 40000000, regulation: 'GDPR', articles: '7,13,15,17,26', summary: '€40 million fine for consent violations in advertising technology. Criteo failed to demonstrate valid consent was obtained for tracking users across websites.', impact: 'DPAs with adtech processors must explicitly address consent verification and provide mechanisms for consent withdrawal across the processing chain.', clauseImpact: 'data_processing_purpose,data_subject_rights', severity: 'high' },
  { authority: 'Garante', country: 'Italy', date: new Date('2024-03-22'), entity: 'OpenAI (ChatGPT)', fineAmount: 15000000, regulation: 'GDPR', articles: '5,6,13,25', summary: '€15 million fine for processing user data without adequate legal basis, insufficient transparency, and no age verification mechanism.', impact: 'AI service DPAs must address legal basis for model training, transparency about data usage, and age verification obligations.', clauseImpact: 'data_processing_purpose,data_subject_rights,security_measures', severity: 'high' },
  { authority: 'ICO', country: 'UK', date: new Date('2023-06-16'), entity: 'TikTok', fineAmount: 12700000, regulation: 'UK-GDPR', articles: '5,12,13,35', summary: '£12.7 million fine for processing children\'s data without appropriate consent and failing to carry out Data Protection Impact Assessment.', impact: 'DPAs involving children\'s data must include specific safeguards, DPIA requirements, and age-appropriate design checks.', clauseImpact: 'data_processing_purpose,security_measures', severity: 'high' },
  { authority: 'BfDI', country: 'Germany', date: new Date('2023-12-11'), entity: 'Deutsche Telekom', fineAmount: 900000, regulation: 'GDPR', articles: '28,32', summary: '€900K fine for inadequate processor agreements — multiple DPAs missing mandatory clauses and failure to audit sub-processors.', impact: 'Direct DPA compliance enforcement — regulators now actively auditing the DPAs themselves, not just data breaches.', clauseImpact: 'audit_rights,subprocessor_controls,security_measures', severity: 'critical' },
  { authority: 'AEPD', country: 'Spain', date: new Date('2024-05-15'), entity: 'CaixaBank', fineAmount: 6000000, regulation: 'GDPR', articles: '6,32,33', summary: '€6 million fine for insufficient security measures and delayed breach notification after a vulnerability exposed customer account data.', impact: 'DPAs must specify concrete security standards (not just "appropriate measures") and enforce strict breach notification timelines.', clauseImpact: 'security_measures,breach_notification', severity: 'high' },
  { authority: 'EDPB', country: 'EU', date: new Date('2024-10-14'), entity: 'Binding Decision on Meta (Cross-platform)', fineAmount: 0, regulation: 'GDPR', articles: '5,6,13', summary: 'EDPB binding decision requiring all DPAs to prohibit bundled consent across platforms. Processors cannot combine data across services without specific separate consent.', impact: 'DPAs for multi-service processors must prohibit cross-service data combination and require separate consent per processing purpose.', clauseImpact: 'data_processing_purpose', severity: 'medium' },
  { authority: 'CPPA', country: 'US-CA', date: new Date('2024-08-20'), entity: 'Sephora', fineAmount: 1200000, regulation: 'CCPA', articles: '1798.100,1798.120', summary: '$1.2 million settlement for selling consumer data without notice, failing to honor opt-out requests, and not processing GPC signals.', impact: 'CCPA service provider agreements must address do-not-sell obligations and Global Privacy Control (GPC) signal processing.', clauseImpact: 'data_subject_rights,data_processing_purpose', severity: 'medium' }
];

// ─── Regulatory Guidance Seed Data ────────────────────
const REGULATORY_GUIDANCE = [
  { authority: 'EDPB', title: 'Guidelines 07/2020 on controller and processor', date: new Date('2021-07-07'), regulation: 'GDPR', summary: 'Clarification on the concepts of controller, processor, and joint controller. Key points: processor must not determine purposes, controller retains ultimate responsibility, DPA must reflect actual roles.', implications: 'Audit DPAs to verify controller/processor roles match actual data flows. Misidentification can invalidate the entire agreement.', clauseImpact: 'data_processing_purpose,subprocessor_controls' },
  { authority: 'EDPB', title: 'Recommendations 01/2020 on supplementary measures for transfers', date: new Date('2021-06-18'), regulation: 'GDPR', summary: 'Post-Schrems II guidance: assess third country legislation, adopt supplementary technical/contractual/organizational measures if SCCs alone are insufficient. Includes Transfer Impact Assessment (TIA) methodology.', implications: 'Every cross-border DPA must now include a TIA. SCCs alone are not sufficient — supplementary measures must be documented.', clauseImpact: 'cross_border_transfer' },
  { authority: 'ICO', title: 'International Data Transfer Agreement (IDTA) Guidance', date: new Date('2022-03-21'), regulation: 'UK-GDPR', summary: 'UK-specific transfer mechanism replacing EU SCCs for restricted transfers from the UK. Must use UK IDTA or UK Addendum to EU SCCs.', implications: 'DPAs involving UK data must incorporate UK IDTA provisions, not just EU SCCs.', clauseImpact: 'cross_border_transfer' },
  { authority: 'EDPB', title: 'Guidelines 9/2022 on personal data breach notification', date: new Date('2023-03-28'), regulation: 'GDPR', summary: 'Updated guidance on breach notification: clarifies "without undue delay" means immediately, 72 hours starts when processor notifies controller, documented risk assessment for every breach.', implications: 'DPA breach notification clauses must specify immediate processor notification (not just "without undue delay"), require documented risk assessment, and define notification content.', clauseImpact: 'breach_notification' },
  { authority: 'CNIL', title: 'Guide on subprocessors under GDPR', date: new Date('2023-11-15'), regulation: 'GDPR', summary: 'Detailed guidance on sub-processor governance: prior authorization requirement must be specific or general, maintained sub-processor list, controller right to object within specified timeframe, flow-down obligations must be contractually equivalent.', implications: 'DPA sub-processor clauses must include maintained list, notification of changes, right to object (suggest 30 days), and verified flow-down obligations.', clauseImpact: 'subprocessor_controls' },
  { authority: 'ANPD', title: 'Resolution on International Data Transfers', date: new Date('2024-02-23'), regulation: 'LGPD', summary: 'Brazil\'s ANPD published standard contractual clauses for international transfers and guidance on transfer impact assessments specific to Brazilian law.', implications: 'DPAs involving Brazilian data must use ANPD-approved transfer mechanisms, not just GDPR SCCs.', clauseImpact: 'cross_border_transfer' },
  { authority: 'EDPB', title: 'Guidelines on AI and GDPR compliance', date: new Date('2024-12-10'), regulation: 'GDPR', summary: 'Guidance on the intersection of AI systems and GDPR. Key requirements: purpose limitation for training data, DPIA for high-risk AI, transparency about automated decision-making, human oversight mechanisms.', implications: 'DPAs with AI service providers must address: whether data can be used for model training, DPIA requirements, transparency obligations, and human review mechanisms.', clauseImpact: 'data_processing_purpose,security_measures,data_subject_rights' },
  { authority: 'CPPA', title: 'Draft regulations on cybersecurity audits and risk assessments', date: new Date('2025-03-15'), regulation: 'CCPA', summary: 'California proposing mandatory cybersecurity audits for large processors handling sensitive data. Annual audit requirements, third-party assessor requirements, and standardized reporting.', implications: 'CCPA service provider agreements should begin incorporating audit rights and cybersecurity assessment clauses ahead of final regulations.', clauseImpact: 'audit_rights,security_measures' }
];

/**
 * Seed the legal knowledge database.
 * Safe to run multiple times — uses upsert logic.
 */
async function seedLegalDatabase() {
  let regulationCount = 0;
  let articleCount = 0;
  let enforcementCount = 0;
  let guidanceCount = 0;

  for (const reg of REGULATIONS) {
    const { articles, ...regData } = reg;
    const existing = await prisma.regulation.findUnique({ where: { code: reg.code } });
    let regulation;
    if (existing) {
      regulation = await prisma.regulation.update({ where: { code: reg.code }, data: regData });
    } else {
      regulation = await prisma.regulation.create({ data: regData });
      regulationCount++;
    }

    // Remove old articles and re-create
    await prisma.regulationArticle.deleteMany({ where: { regulationId: regulation.id } });
    for (const art of articles) {
      await prisma.regulationArticle.create({
        data: { ...art, regulationId: regulation.id }
      });
      articleCount++;
    }
  }

  // Seed enforcement actions
  const existingEnforcements = await prisma.enforcementAction.count();
  if (existingEnforcements === 0) {
    for (const ea of ENFORCEMENT_ACTIONS) {
      await prisma.enforcementAction.create({ data: ea });
      enforcementCount++;
    }
  }

  // Seed regulatory guidance
  const existingGuidance = await prisma.regulatoryGuidance.count();
  if (existingGuidance === 0) {
    for (const rg of REGULATORY_GUIDANCE) {
      await prisma.regulatoryGuidance.create({ data: rg });
      guidanceCount++;
    }
  }

  return { regulationCount, articleCount, enforcementCount, guidanceCount };
}

/**
 * Get all regulations with article counts.
 */
async function getRegulations() {
  return prisma.regulation.findMany({
    include: { articles: { select: { id: true, articleNum: true, title: true, relatedClauses: true } } },
    orderBy: { code: 'asc' }
  });
}

/**
 * Get regulation with full articles.
 */
async function getRegulation(code) {
  return prisma.regulation.findUnique({
    where: { code },
    include: { articles: { orderBy: { articleNum: 'asc' } } }
  });
}

/**
 * Find articles relevant to a specific DPA clause type.
 */
async function getArticlesForClause(clauseType) {
  const articles = await prisma.regulationArticle.findMany({
    where: { relatedClauses: { contains: clauseType } },
    include: { regulation: { select: { code: true, name: true, jurisdiction: true } } },
    orderBy: { regulationId: 'asc' }
  });
  return articles;
}

/**
 * Search articles by keyword.
 */
async function searchArticles(query) {
  const q = query.toLowerCase();
  const articles = await prisma.regulationArticle.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } }
      ]
    },
    include: { regulation: { select: { code: true, name: true } } },
    take: 20
  });
  return articles;
}

module.exports = {
  seedLegalDatabase,
  getRegulations,
  getRegulation,
  getArticlesForClause,
  searchArticles,
  REGULATIONS,
  ENFORCEMENT_ACTIONS,
  REGULATORY_GUIDANCE
};
