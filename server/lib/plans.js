// Plan definitions with limits
const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    auditsPerMonth: 3,
    maxUsers: 1,
    storageMb: 50,
    apiCallsPerMonth: 0,
    features: ['basic_audit', 'export_json', 'export_csv'],
    description: 'Try it out — basic DPA analysis'
  },
  starter: {
    name: 'Starter',
    price: 2900, // cents = $29/mo
    auditsPerMonth: 25,
    maxUsers: 5,
    storageMb: 500,
    apiCallsPerMonth: 500,
    features: ['basic_audit', 'export_json', 'export_csv', 'templates', 'sharing', 'comments', 'compliance_report'],
    description: 'For solo practitioners and small teams'
  },
  pro: {
    name: 'Pro',
    price: 9900, // cents = $99/mo
    auditsPerMonth: 100,
    maxUsers: 15,
    storageMb: 2000,
    apiCallsPerMonth: 5000,
    features: ['basic_audit', 'export_json', 'export_csv', 'batch_upload', 'webhooks', 'templates', 'scheduling', 'sharing', 'comments', 'compliance_report', 'version_diff', 'api_keys', 'dual_ai'],
    description: 'For growing teams with advanced AI analysis'
  },
  business: {
    name: 'Business',
    price: 24900, // cents = $249/mo
    auditsPerMonth: 500,
    maxUsers: 50,
    storageMb: 10000,
    apiCallsPerMonth: 25000,
    features: ['basic_audit', 'export_json', 'export_csv', 'batch_upload', 'webhooks', 'templates', 'scheduling', 'sharing', 'comments', 'compliance_report', 'version_diff', 'api_keys', 'dual_ai', 'legal_agents', 'custom_scoring', 'admin_panel'],
    description: 'For multi-department organizations'
  },
  enterprise: {
    name: 'Enterprise',
    price: 99900, // cents = $999/mo
    auditsPerMonth: -1, // unlimited
    maxUsers: -1,
    storageMb: -1,
    apiCallsPerMonth: -1,
    features: ['basic_audit', 'export_json', 'export_csv', 'batch_upload', 'webhooks', 'templates', 'scheduling', 'sharing', 'comments', 'compliance_report', 'version_diff', 'api_keys', 'dual_ai', 'legal_agents', 'custom_scoring', 'admin_panel', 'sso', 'priority_support', 'sla', 'dedicated_support'],
    description: 'Full platform with SSO, SLA, and priority support'
  }
};

function getPlan(planName) {
  return PLANS[planName] || PLANS.free;
}

module.exports = { PLANS, getPlan };
