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

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  BusinessRegistration: 'Business Registration',
  BusinessAddressProof: 'Business Address Proof',
  IDFront: 'ID — Front',
  IDBack: 'ID — Back',
  PersonalAddressProof: 'Personal Address Proof',
  DiversityCert: 'Diversity Certification',
  TrademarkDoc: 'Trademark Document',
  RepID: 'Representative ID',
  AuthorizationLetter: 'Authorization Letter',
  BankStatement: 'Bank Statement',
  CreditCardFront: 'Credit Card Front',
  W9: 'W-9 Form',
  Other: 'Other Document',
};
