import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  DEMO_ACCESS_COOKIE,
  DEMO_ACCESS_REDIRECT_PARAM,
  getConfiguredDemoAccessCode,
  isDemoAccessEnabled,
} from "@/lib/auth/demo-access";

function isExcludedPath(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

function isAuthorized(request: NextRequest, accessCode: string) {
  return request.cookies.get(DEMO_ACCESS_COOKIE)?.value === accessCode;
}

function getSafeRedirectTarget(value: string | null) {
  return value && value.startsWith("/") ? value : "/";
}

export function middleware(request: NextRequest) {
  if (!isDemoAccessEnabled()) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;

  if (isExcludedPath(pathname)) {
    return NextResponse.next();
  }

  const accessCode = getConfiguredDemoAccessCode();
  const authorized = isAuthorized(request, accessCode);
  const isAccessPage = pathname === "/demo-access";
  const isAccessApi = pathname === "/api/demo-access";

  if (authorized) {
    if (isAccessPage) {
      const redirectTo = getSafeRedirectTarget(
        request.nextUrl.searchParams.get(DEMO_ACCESS_REDIRECT_PARAM),
      );
      return NextResponse.redirect(new URL(redirectTo, request.url));
    }

    return NextResponse.next();
  }

  if (isAccessPage || isAccessApi) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Demo access code required." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/demo-access", request.url);
  const requestedPath = getSafeRedirectTarget(`${pathname}${search}`);
  loginUrl.searchParams.set(DEMO_ACCESS_REDIRECT_PARAM, requestedPath);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
