import { redirect } from "next/navigation";

// The middleware handles authentication:
//   - Unauthenticated users → /login
//   - Authenticated users at /login → /overview
// Root "/" just funnels traffic; middleware does the right redirect.
export default function RootPage() {
  redirect("/overview");
}
