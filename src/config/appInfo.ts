export interface DeveloperSocialLink {
  id: 'facebook' | 'instagram' | 'github' | 'website';
  label: string;
  handle: string;
  url: string;
}

export interface DeveloperProfileInfo {
  name: string;
  title?: string;
  biography?: string;
  ownershipStatement?: string;
  email?: string;
  socialLinks?: DeveloperSocialLink[];
}

export interface ProductInfo {
  name: string;
  suiteName: string;
  version: string;
  description: string;
  mission: string;
  capabilities: Array<{
    title: string;
    detail: string;
  }>;
}

export interface ThirdPartyLicense {
  name: string;
  license: string;
  role: string;
}

export const APP_VERSION = '1.0.0';
export const APP_COPYRIGHT_YEAR = new Date().getFullYear();
export const APP_SUITE_NAME = 'Lazy Editor';
export const APP_PRODUCT_NAME = 'Lazy Editor';

export const DEVELOPER_PROFILE: DeveloperProfileInfo = {
  name: 'Kyami Yokai',
  title: 'Founder & Developer',
  biography:
    'Here i’M trying to help lazy people, so make sure you buy the Subscription!!',
  ownershipStatement:
    'Lazy Editor is independently developed, maintained, and owned by Kyami Yokai.',
  email: 'kyamiyokai@gmail.com',
  socialLinks: [
    {
      id: 'facebook',
      label: 'Facebook',
      handle: 'facebook.com/kyamixd',
      url: 'https://facebook.com/kyamixd',
    },
    {
      id: 'instagram',
      label: 'Instagram',
      handle: '@onliformurasaki',
      url: 'https://instagram.com/onliformurasaki',
    },
    {
      id: 'github',
      label: 'GitHub',
      handle: 'github.com/kyamixdd',
      url: 'https://github.com/kyamixdd',
    },
  ],
};

export const PRODUCT_INFO: ProductInfo = {
  name: APP_PRODUCT_NAME,
  suiteName: APP_SUITE_NAME,
  version: APP_VERSION,
  description:
    'Lazy Editor is a professional document editing and PDF production platform designed to simplify document customization, template management, serial numbering, and large-scale PDF generation.',
  mission:
    'Our mission is to make professional document editing and bulk PDF production more precise, efficient, and accessible.',
  capabilities: [
    {
      title: 'Local PDF Analysis & OCR',
      detail:
        'Extracts text, exact coordinates, fonts, colors, vector borders, tables, and repeated receipt blocks locally via PDF.js and optional Tesseract.js OCR while preserving original PDF bytes.',
    },
    {
      title: 'Precision Visual Layout Editor',
      detail:
        'Interactive canvas with calibrated rulers, configurable snap-to-grid and smart alignment guides, multi-selection, grouping, tables, and version snapshots.',
    },
    {
      title: 'Multi-Copy Imposition & Bulk Serials',
      detail:
        'Arrange 1 to 12+ copies per sheet or custom grids with bleed, crop marks, cutting guides, and continuous multi-block serial numbering sequences.',
    },
    {
      title: 'Data Merge, Preflight QC & Export',
      detail:
        'Spreadsheet data manager for CSV/XLSX imports, formulas, field mapping, automated preflight quality checks, and Print-Ready PDF or ZIP export.',
    },
    {
      title: 'Optional User-Triggered AI Assist',
      detail:
        'When Gemini API access is configured and explicitly invoked by the user, optional semantic layout analysis and natural-language edit previews assist complex workflows.',
    },
  ],
};

export const OPEN_SOURCE_LICENSES: ThirdPartyLicense[] = [
  { name: 'PDF.js (pdfjs-dist)', license: 'Apache-2.0', role: 'Local PDF parsing, rendering & coordinate extraction' },
  { name: 'pdf-lib & @pdf-lib/fontkit', license: 'MIT', role: 'Vector PDF imposition, font embedding & generation' },
  { name: 'Konva', license: 'MIT', role: 'Interactive hardware-accelerated canvas editing' },
  { name: 'Tesseract.js', license: 'Apache-2.0', role: 'On-device OCR for scanned/image-only PDF pages' },
  { name: 'React & React DOM', license: 'MIT', role: 'Component architecture and interface rendering' },
  { name: 'Tailwind CSS', license: 'MIT', role: 'Design system styling & responsive layout utilities' },
  { name: 'Lucide Icons', license: 'ISC', role: 'Vector interface iconography' },
  { name: 'JSZip', license: 'MIT / GPLv3', role: 'Multi-document & per-page ZIP archive export' },
  { name: 'SheetJS (xlsx)', license: 'Apache-2.0', role: 'CSV and Excel spreadsheet import & export' },
  { name: 'Motion', license: 'MIT', role: 'Reduced-motion-aware interface transitions' },
  { name: '@google/genai', license: 'Apache-2.0', role: 'Optional user-initiated Gemini document analysis' },
];
