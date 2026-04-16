export function parseCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const found = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!found) {
    return null;
  }

  return decodeURIComponent(found.slice(name.length + 1));
}
