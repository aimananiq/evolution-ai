import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async () => {
  const locale = process.env.DEFAULT_LOCALE ?? "en-GB";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
