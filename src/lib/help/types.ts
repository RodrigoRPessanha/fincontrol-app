export interface HelpSection {
  id: string;
  title: string;
  paragraphs?: string[];
  steps?: string[];
  fields?: { name: string; description: string }[];
  note?: string;
}

export interface HelpPicture {
  src: string;
  alt: string;
  caption: string;
  width: number;
  height: number;
}

export interface HelpArticle {
  slug: string;
  title: string;
  summary: string;
  category: string;
  prerequisites: string;
  screen: string;
  screenLabel: string;
  related: string[];
  sections: HelpSection[];
  image?: HelpPicture;
  mobileImage?: HelpPicture;
}
