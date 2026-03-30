export const DEMO_ACCESS_COOKIE = "readily_demo_access";
export const DEMO_ACCESS_REDIRECT_PARAM = "redirectTo";

export function getConfiguredDemoAccessCode() {
  return process.env.DEMO_ACCESS_CODE?.trim() ?? "";
}

export function isDemoAccessEnabled() {
  return getConfiguredDemoAccessCode().length > 0;
}
