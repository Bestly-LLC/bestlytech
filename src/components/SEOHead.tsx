import { Helmet } from "react-helmet-async";

interface SEOHeadProps {
  title: string;
  description: string;
  path?: string;
  image?: string;
  type?: "website" | "article" | "product";
}

const BASE_URL = "https://bestly.tech";
const DEFAULT_IMAGE = "/og-image.png";

export function SEOHead({
  title,
  description,
  path = "",
  image = DEFAULT_IMAGE,
  type = "website",
}: SEOHeadProps) {
  const fullUrl = `${BASE_URL}${path}`;
  const fullTitle = title.includes("Bestly") ? title : `${title} | Bestly LLC`;
  const imageUrl = image.startsWith("http") ? image : `${BASE_URL}${image}`;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{fullTitle}</title>
      <meta name="title" content={fullTitle} />
      <meta name="description" content={description} />
      <link rel="canonical" href={fullUrl} />

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={type} />
      <meta property="og:url" content={fullUrl} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:site_name" content="Bestly LLC" />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={fullUrl} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
    </Helmet>
  );
}
