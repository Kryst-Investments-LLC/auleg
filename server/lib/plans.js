// Plan definitions with limits
const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    auditsPerMonth: 10,
    maxUsers: 3,
    storageMb: 100,
    apiCallsPerMonth: 100,
    features: ['basic_audit', 'export_json', 'export_csv'],
    description: 'For individuals getting started'
  },
  pro: {
    name: 'Pro',
    price: 4900, // cents = $49/mo
    auditsPerMonth: 100,
    maxUsers: 15,
    storageMb: 2000,
    apiCallsPerMonth: 5000,
    features: ['basic_audit', 'export_json', 'export_csv', 'batch_upload', 'webhooks', 'templates', 'scheduling', 'sharing', 'comments', 'compliance_report', 'version_diff', 'api_keys'],
    description: 'For teams and growing businesses'
  },
  enterprise: {
    name: 'Enterprise',
    price: 19900, // cents = $199/mo
    auditsPerMonth: -1, // unlimited
    maxUsers: -1,
    storageMb: -1,
    apiCallsPerMonth: -1,
    features: ['basic_audit', 'export_json', 'export_csv', 'batch_upload', 'webhooks', 'templates', 'scheduling', 'sharing', 'comments', 'compliance_report', 'version_diff', 'api_keys', 'custom_scoring', 'admin_panel', 'sso', 'priority_support'],
    description: 'For large organizations with advanced needs'
  }
};

function getPlan(planName) {
  return PLANS[planName] || PLANS.free;
}

module.exports = { PLANS, getPlan };
