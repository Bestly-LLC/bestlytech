export const US_STATES = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'District of Columbia' }, { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' }, { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' }, { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' }, { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' }, { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' }, { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' }, { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
];

export const COUNTRIES = [
  { value: 'US', label: 'United States' }, { value: 'CA', label: 'Canada' },
  { value: 'GB', label: 'United Kingdom' }, { value: 'MX', label: 'Mexico' },
  { value: 'IN', label: 'India' }, { value: 'CN', label: 'China' },
  { value: 'PK', label: 'Pakistan' }, { value: 'PH', label: 'Philippines' },
  { value: 'NG', label: 'Nigeria' }, { value: 'BR', label: 'Brazil' },
  { value: 'DE', label: 'Germany' }, { value: 'FR', label: 'France' },
  { value: 'JP', label: 'Japan' }, { value: 'KR', label: 'South Korea' },
  { value: 'AU', label: 'Australia' }, { value: 'IT', label: 'Italy' },
  { value: 'ES', label: 'Spain' }, { value: 'NL', label: 'Netherlands' },
  { value: 'SE', label: 'Sweden' }, { value: 'CH', label: 'Switzerland' },
  { value: 'AE', label: 'United Arab Emirates' }, { value: 'SA', label: 'Saudi Arabia' },
  { value: 'SG', label: 'Singapore' }, { value: 'HK', label: 'Hong Kong' },
  { value: 'TW', label: 'Taiwan' }, { value: 'TH', label: 'Thailand' },
  { value: 'VN', label: 'Vietnam' }, { value: 'CO', label: 'Colombia' },
  { value: 'AR', label: 'Argentina' }, { value: 'EG', label: 'Egypt' },
  { value: 'ZA', label: 'South Africa' }, { value: 'KE', label: 'Kenya' },
  { value: 'GH', label: 'Ghana' }, { value: 'IL', label: 'Israel' },
  { value: 'TR', label: 'Turkey' }, { value: 'PL', label: 'Poland' },
  { value: 'RO', label: 'Romania' }, { value: 'UA', label: 'Ukraine' },
  { value: 'BD', label: 'Bangladesh' }, { value: 'ET', label: 'Ethiopia' },
];

export const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
];

export const PRODUCT_CATEGORIES = [
  'Health & Beauty', 'Food & Beverage', 'Home & Kitchen',
  'Clothing & Accessories', 'Electronics', 'Sports & Outdoors',
  'Arts & Crafts', 'Toys & Games', 'Pet Supplies', 'Other',
];

export const REGISTERED_AGENT_SERVICES = [
  'ZenBusiness', 'LegalZoom', 'Northwest Registered Agent',
  'Incfile', 'Self/None', 'Other',
];

export const BUSINESS_TYPES = [
  'LLC', 'Corporation', 'Sole Proprietor', 'Partnership',
];

export const OWNER_TITLES = [
  'Owner', 'CEO', 'Managing Member', 'Sole Proprietor', 'President', 'Partner', 'Other',
];

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  BusinessRegistration: 'Business Registration',
  BusinessAddressProof: 'Business Address Proof',
  IDFront: 'ID \u2014 Front',
  IDBack: 'ID \u2014 Back',
  PersonalAddressProof: 'Personal Address Proof',
  DiversityCert: 'Diversity Certification',
  TrademarkDoc: 'Trademark Document',
  RepID: 'Representative ID',
  AuthorizationLetter: 'Authorization Letter',
  BankStatement: 'Bank Statement',
  CreditCardFront: 'Credit Card Front',
  W9: 'W-9 Form',
  BrandLogo: 'Brand Logo',
  Other: 'Other Document',
};

export const PLATFORM_OPTIONS = [
  { value: 'Amazon', label: 'Amazon', description: 'Sell on Amazon Seller Central' },
  { value: 'Shopify', label: 'Shopify', description: 'Launch your own Shopify store' },
  { value: 'TikTok', label: 'TikTok Shop', description: 'Sell directly on TikTok' },
];

export const SHOPIFY_PLANS = [
  { value: 'Basic', label: 'Basic', description: 'For solo entrepreneurs \u2014 $39/month' },
  { value: 'Shopify', label: 'Shopify', description: 'For small teams \u2014 $105/month' },
  { value: 'Advanced', label: 'Advanced', description: 'For scaling businesses \u2014 $399/month' },
];

export const SHIPPING_METHODS = [
  { value: 'Self', label: "I'll ship orders myself" },
  { value: '3PL', label: 'Third-party logistics (3PL)' },
  { value: 'Dropship', label: 'Dropshipping' },
];

export const TIKTOK_CATEGORIES = [
  'Beauty & Personal Care', 'Fashion & Accessories', 'Food & Beverages',
  'Health & Wellness', 'Home & Living', 'Electronics & Gadgets',
  'Sports & Outdoor', 'Baby & Kids', 'Pet Supplies', 'Other',
];

export const TIKTOK_FULFILLMENT = [
  { value: 'Self', label: 'Ship orders myself' },
  { value: 'TikTok', label: 'Fulfilled by TikTok' },
  { value: 'Both', label: 'Both / Not sure yet' },
];

export const AMAZON_MARKETPLACES = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'MX', label: 'Mexico' },
  { value: 'UK', label: 'United Kingdom' },
  { value: 'EU', label: 'European Union' },
  { value: 'AU', label: 'Australia' },
  { value: 'JP', label: 'Japan' },
];

export const SHOPIFY_THEME_STYLES = [
  { value: 'minimal', label: 'Minimal / Clean' },
  { value: 'bold', label: 'Bold / Modern' },
  { value: 'luxury', label: 'Luxury / Premium' },
  { value: 'playful', label: 'Playful / Colorful' },
  { value: 'no_preference', label: 'No preference' },
];

export const SHOPIFY_PAYMENT_GATEWAYS = [
  { value: 'Shopify Payments', label: 'Shopify Payments (recommended)' },
  { value: 'PayPal', label: 'PayPal' },
  { value: 'Other', label: 'Other' },
];

export const TIKTOK_PRICE_RANGES = [
  { value: 'Under $10', label: 'Under $10' },
  { value: '$10-$25', label: '$10 - $25' },
  { value: '$25-$50', label: '$25 - $50' },
  { value: '$50-$100', label: '$50 - $100' },
  { value: '$100+', label: '$100+' },
];

// Expanded platform-specific readiness checklist items
export const READINESS_ITEMS: Record<string, { text: string; key: string }[]> = {
  Amazon: [
    { key: 'state_reg', text: 'Your state business registration document (Certificate of Formation, Articles of Organization, or equivalent)' },
    { key: 'ein', text: 'Your EIN (Employer Identification Number) from the IRS' },
    { key: 'gov_id', text: "The business owner's government-issued photo ID (passport or driver's license \u2014 not expired)" },
    { key: 'bank_statement', text: 'A recent bank statement (within 180 days) showing the business name and address \u2014 must be a full statement with transactions' },
    { key: 'address_proof', text: "A recent utility bill OR bank statement showing the owner's personal residential address (within 180 days)" },
    { key: 'bank_details', text: 'Bank account details (account number, routing number) for receiving payments' },
    { key: 'credit_card', text: "A credit or debit card for the monthly seller subscription fee ($39.99/month)" },
    { key: 'product_photos', text: 'Product photos/samples and content for listings' },
  ],
  Shopify: [
    { key: 'state_reg', text: 'Your state business registration document' },
    { key: 'gov_id', text: "The business owner's government-issued photo ID (required for Shopify Payments verification)" },
    { key: 'ssn_itin', text: 'SSN or ITIN (required for Shopify Payments activation)' },
    { key: 'bank_details', text: 'Bank account details for receiving Shopify Payments payouts' },
    { key: 'credit_card', text: 'A credit or debit card for Shopify subscription billing' },
    { key: 'address_proof_shopify', text: 'Proof of home address (utility bill or bank statement, within 3 months) for Shopify Payments' },
    { key: 'product_photos', text: 'Product photos and descriptions ready for listing' },
  ],
  TikTok: [
    { key: 'gov_id', text: "The business owner's government-issued photo ID (passport, driver's license, or state ID)" },
    { key: 'ssn_itin', text: 'SSN or ITIN (required for TikTok W-9 tax submission)' },
    { key: 'state_reg', text: 'Business license or registration document' },
    { key: 'ein_doc', text: 'IRS EIN documentation (official IRS letter showing EIN \u2014 for business sellers)' },
    { key: 'bank_details', text: 'Bank account details (account number, routing number) for TikTok Shop payouts' },
    { key: 'warehouse_address', text: 'Warehouse/return address \u2014 must be a verified USPS physical address' },
    { key: 'product_photos', text: 'Product photos/samples and content for listings' },
  ],
};

// Formatting helpers
export const formatPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
};

export const formatDate = (dateStr: string): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

export const autoFormatPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export const autoFormatEin = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
};
