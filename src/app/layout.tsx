import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Sans } from "next/font/google";
import { TimeZoneCookie } from "@/components/TimeZoneCookie";
import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  weight: ["500", "700"],
});

const plex = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Ma Classe",
  description: "Private French classroom",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${bricolage.variable} ${plex.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <LocaleProvider locale={locale}>
          <TimeZoneCookie />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
