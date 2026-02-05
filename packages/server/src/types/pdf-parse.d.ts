declare module 'pdf-parse' {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    text: string;
    version: string;
  }

  interface Options {
    max?: number;
    version?: string;
  }

  function pdfParse(dataBuffer: Buffer, options?: Options): Promise<PDFData>;
  export = pdfParse;
}
