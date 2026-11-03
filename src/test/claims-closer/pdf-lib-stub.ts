// vitest stand-in for npm:pdf-lib (Deno import specifier). Claims Closer tests never build a PDF.
export const PDFDocument = { create: async () => ({ addPage: () => ({ drawText() {} }), embedFont: async () => ({ widthOfTextAtSize: () => 10 }), save: async () => new Uint8Array() }) };
export const StandardFonts = { Helvetica: "Helvetica", HelveticaBold: "Helvetica-Bold" };
export const rgb = () => ({});
