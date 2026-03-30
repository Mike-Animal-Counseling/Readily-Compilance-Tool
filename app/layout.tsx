import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Readily Compliance Review",
  description:
    "Healthcare compliance review MVP for extracting audit questions, retrieving policy evidence, and generating grounded preliminary answers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body>{children}</body>
    </html>
  );
}
