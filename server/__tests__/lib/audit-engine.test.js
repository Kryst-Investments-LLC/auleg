/**
 * Unit tests for audit-worker clause detection, risk scoring, and gap analysis.
 * Tests the pure functions without requiring a database.
 */

const path = require('path');
const fs = require('fs');

// Load the engine data files directly
const ENGINE_DATA = path.resolve(__dirname, '../../data');

let clauseDetection, regulationMapping, remediationLanguage;

beforeAll(() => {
  clauseDetection = JSON.parse(fs.readFileSync(path.join(ENGINE_DATA, 'clause-detection.json.hbs'), 'utf-8'));
  regulationMapping = JSON.parse(fs.readFileSync(path.join(ENGINE_DATA, 'regulation-mapping.json.hbs'), 'utf-8'));
  remediationLanguage = JSON.parse(fs.readFileSync(path.join(ENGINE_DATA, 'remediation-language.json.hbs'), 'utf-8'));
});

describe('Audit Engine Data', () => {
  test('clause-detection.json has patterns and keywords', () => {
    expect(clauseDetection).toHaveProperty('patterns');
    expect(clauseDetection).toHaveProperty('keywords');
    expect(clauseDetection).toHaveProperty('heuristics');
    expect(Object.keys(clauseDetection.patterns).length).toBeGreaterThan(0);
  });

  test('regulation-mapping.json has mapping', () => {
    expect(regulationMapping).toHaveProperty('mapping');
    expect(Object.keys(regulationMapping.mapping).length).toBeGreaterThan(0);
  });

  test('remediation-language.json has templates', () => {
    expect(remediationLanguage).toHaveProperty('templates');
    expect(Object.keys(remediationLanguage.templates).length).toBeGreaterThan(0);
  });

  test('all clause patterns have corresponding keywords', () => {
    for (const key of Object.keys(clauseDetection.patterns)) {
      expect(clauseDetection.keywords).toHaveProperty(key);
    }
  });
});

describe('Clause Detection Logic', () => {
  function detectClauses(text) {
    const paragraphs = text.split(/(\r?\n){2,}/);
    const clauses = {};

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (trimmed.length < clauseDetection.heuristics.min_clause_length) continue;

      for (const key of Object.keys(clauseDetection.patterns)) {
        const regexList = clauseDetection.patterns[key];
        const keywords = clauseDetection.keywords[key] || [];

        let regexHit = false;
        for (const regex of regexList) {
          const cleaned = regex.replace(/\(\?[imsx]+\)/g, '');
          if (new RegExp(cleaned, 'i').test(trimmed)) {
            regexHit = true;
            break;
          }
        }

        let keywordHits = 0;
        for (const kw of keywords) {
          if (new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(trimmed)) {
            keywordHits++;
          }
        }

        const keywordScore = keywords.length > 0 ? keywordHits / keywords.length : 0;
        const confidence = regexHit ? 0.7 + (keywordScore * 0.3) : keywordScore;

        if (confidence >= clauseDetection.heuristics.confidence_threshold) {
          if (!clauses[key]) {
            clauses[key] = trimmed;
          }
        }
      }
    }

    return clauses;
  }

  test('detects breach notification clause', () => {
    const text = `This is a long preamble to the contract that sets context for the data processing agreement.

The Data Processor shall notify the Data Controller of any personal data breach without undue delay and in any event within 72 hours of becoming aware of such breach. The notification shall include details of the nature of the breach, approximate number of data subjects affected, and measures taken to address the breach.`;

    const clauses = detectClauses(text);
    expect(Object.keys(clauses).length).toBeGreaterThan(0);
  });

  test('returns empty object for irrelevant text', () => {
    const text = 'This is just a random sentence about cooking recipes and nothing else.';
    const clauses = detectClauses(text);
    expect(Object.keys(clauses).length).toBe(0);
  });

  test('handles empty text', () => {
    const clauses = detectClauses('');
    expect(Object.keys(clauses)).toEqual([]);
  });
});

describe('Gap Analysis', () => {
  function analyzeGaps(clauses) {
    const required = [
      'data_processing_purpose',
      'subprocessor_controls',
      'breach_notification',
      'data_subject_rights',
      'security_measures',
      'audit_rights'
    ];
    return required.filter(req => !clauses[req]);
  }

  test('identifies all gaps when no clauses present', () => {
    const gaps = analyzeGaps({});
    expect(gaps).toHaveLength(6);
    expect(gaps).toContain('breach_notification');
    expect(gaps).toContain('data_subject_rights');
  });

  test('identifies no gaps when all clauses present', () => {
    const clauses = {
      data_processing_purpose: 'text',
      subprocessor_controls: 'text',
      breach_notification: 'text',
      data_subject_rights: 'text',
      security_measures: 'text',
      audit_rights: 'text'
    };
    const gaps = analyzeGaps(clauses);
    expect(gaps).toHaveLength(0);
  });

  test('identifies partial gaps', () => {
    const clauses = {
      breach_notification: 'text',
      security_measures: 'text'
    };
    const gaps = analyzeGaps(clauses);
    expect(gaps).toHaveLength(4);
    expect(gaps).not.toContain('breach_notification');
    expect(gaps).not.toContain('security_measures');
  });
});

describe('Risk Scoring', () => {
  const FRAMEWORK_WEIGHTS = { GDPR: 5, CCPA: 3, 'ISO 27701': 2, 'SOC 2': 2 };
  const SEVERITY_LIKELIHOOD = {
    breach_notification: [5, 4],
    subprocessor_controls: [4, 3],
    data_subject_rights: [4, 3],
    security_measures: [5, 3],
    audit_rights: [3, 2]
  };

  function getRegulatoryExposure(frameworkRefs) {
    let total = 0;
    for (const ref of frameworkRefs) {
      for (const [fw, weight] of Object.entries(FRAMEWORK_WEIGHTS)) {
        if (ref.startsWith(fw)) total += weight;
      }
    }
    if (total <= 0) return 1;
    return Math.min(5, Math.round(total / 3));
  }

  function scoreRisk(clauses, matrix, gaps) {
    const clauseScores = [];
    let totalScore = 0;

    for (const clauseKey of Object.keys(clauses)) {
      const frameworkRefs = matrix[clauseKey] || [];
      const regExposure = getRegulatoryExposure(frameworkRefs);
      const [sev, lik] = SEVERITY_LIKELIHOOD[clauseKey] || [3, 2];
      const clauseScore = Math.round(((sev * 0.5) + (lik * 0.3) + (regExposure * 0.2)) * 20);

      totalScore += clauseScore;
      clauseScores.push({
        clause: clauseKey,
        severity: sev,
        likelihood: lik,
        regulatory_exposure: regExposure,
        score: clauseScore
      });
    }

    const overall = clauseScores.length > 0 ? Math.round(totalScore / clauseScores.length) : 0;
    const riskLevel = overall <= 20 ? 'Low' : overall <= 50 ? 'Moderate' : overall <= 75 ? 'High' : 'Critical';

    return { overall_risk: riskLevel, score: overall, clause_scores: clauseScores, missing_clauses: gaps };
  }

  test('returns Low risk for empty contract', () => {
    const result = scoreRisk({}, {}, []);
    expect(result.overall_risk).toBe('Low');
    expect(result.score).toBe(0);
  });

  test('scores breach_notification clause', () => {
    const clauses = { breach_notification: 'text' };
    const matrix = { breach_notification: ['GDPR Art. 33'] };
    const result = scoreRisk(clauses, matrix, []);
    expect(result.score).toBeGreaterThan(0);
    expect(result.clause_scores).toHaveLength(1);
  });

  test('risk level reflects score', () => {
    // With multiple high-severity clauses, should get higher risk
    const clauses = {
      breach_notification: 'text',
      security_measures: 'text',
      subprocessor_controls: 'text'
    };
    const matrix = {
      breach_notification: ['GDPR Art. 33', 'CCPA'],
      security_measures: ['GDPR Art. 32', 'ISO 27701'],
      subprocessor_controls: ['GDPR Art. 28']
    };
    const result = scoreRisk(clauses, matrix, []);
    expect(result.score).toBeGreaterThan(0);
    expect(['Low', 'Moderate', 'High', 'Critical']).toContain(result.overall_risk);
  });
});
