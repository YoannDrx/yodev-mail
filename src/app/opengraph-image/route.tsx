import { brandImage } from "@/brand/social-image";

const headlines = {
  fr: "Les emails de votre application, pris en charge.",
  en: "Your application’s emails, taken care of.",
} as const;

// A route handler instead of the opengraph-image file convention so that each
// locale gets its own social image while the URL stays outside locale routing.
export function GET(request: Request) {
  const locale = new URL(request.url).searchParams.get("locale") === "en" ? "en" : "fr";
  const image = brandImage("mail", 1200, 630, headlines[locale]);
  image.headers.set("cache-control", "public, max-age=86400, s-maxage=604800");
  return image;
}
