const sampleReport = {
  "gap_report": [],
  "contract": "sample-dpa.txt",
  "compliance_matrix": {
    "security_measures": ["GDPR:32", "SOC2:CC6"],
    "breach_notification": ["GDPR:33", "CCPA:1798.82"],
    "audit_rights": ["GDPR:28(3)(h)", "ISO27701:7.2.8"],
    "data_subject_rights": ["GDPR:15-22", "CCPA:1798.100"],
    "subprocessor_controls": ["GDPR:28(2)", "ISO27701:7.2.6"],
    "data_processing_purpose": ["GDPR:5(1)(b)", "GDPR:6(1)", "CCPA:1798.100(b)"]
  },
  "remediation_plan": [
    {
      "suggested_language": "The Processor shall implement and maintain appropriate technical and organizational measures to ensure a level of security appropriate to the risk, including as appropriate: (a) pseudonymization and encryption; (b) ongoing confidentiality, integrity, availability; (c) timely restoration; (d) regular testing.",
      "clause": "security_measures",
      "action": "strengthen",
      "severity": "Critical",
      "title": "Strengthen: Security Measures Clause",
      "references": ["GDPR Art. 32", "SOC 2 CC6", "ISO 27701 §6.9"],
      "risk_score": 76
    },
    {
      "suggested_language": "The Processor shall notify the Controller without undue delay and within 72 hours of becoming aware of a Personal Data breach, including: nature, categories, consequences, and mitigation measures.",
      "clause": "breach_notification",
      "action": "strengthen",
      "severity": "Critical",
      "title": "Strengthen: Breach Notification Clause",
      "references": ["GDPR Art. 33", "CCPA §1798.82"],
      "risk_score": 86
    },
    {
      "suggested_language": "The Processor shall promptly assist the Controller in responding to data subject requests including access, rectification, erasure, restriction, portability, and objection within 24 hours.",
      "clause": "data_subject_rights",
      "action": "strengthen",
      "severity": "High",
      "title": "Strengthen: Data Subject Rights Clause",
      "references": ["GDPR Art. 15-22", "CCPA §1798.100-1798.125"],
      "risk_score": 70
    }
  ],
  "risk_profile": {
    "missing_clauses": [],
    "score": 68,
    "overall_risk": "High",
    "clause_scores": [
      { "severity": 5, "score": 86, "likelihood": 4, "regulatory_exposure": 3, "clause": "breach_notification" },
      { "severity": 5, "score": 76, "likelihood": 3, "regulatory_exposure": 2, "clause": "security_measures" },
      { "severity": 4, "score": 70, "likelihood": 3, "regulatory_exposure": 3, "clause": "data_subject_rights" },
      { "severity": 4, "score": 66, "likelihood": 3, "regulatory_exposure": 2, "clause": "subprocessor_controls" },
      { "severity": 3, "score": 58, "likelihood": 2, "regulatory_exposure": 4, "clause": "data_processing_purpose" },
      { "severity": 3, "score": 50, "likelihood": 2, "regulatory_exposure": 2, "clause": "audit_rights" }
    ]
  },
  "generated": "2026-04-10T15:47:50.752Z"
};

export default sampleReport;
