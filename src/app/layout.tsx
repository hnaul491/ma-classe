import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TimeZoneCookie } from "@/components/TimeZoneCookie";
import { LocaleProvider } from "@/lib/i18n/client";
import { getLocale } from "@/lib/i18n/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ma Classe",
  description: "Private French classroom",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><LocaleProvider locale={locale}>
          <TimeZoneCookie />
          {children}
        </LocaleProvider></body>
    </html>
  );
}
