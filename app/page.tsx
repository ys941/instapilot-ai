import { redirect } from "next/navigation";
import { DemoRedirect } from "@/components/DemoShim";

// The middleware handles authentication:
//   - Unauthenticated users → /login
//   - Authenticated users at /login → /overview
// Root "/" just funnels traffic; middleware does the right redirect.
export default function RootPage() {
  // The static demo has no server (and no login): go straight to the dashboard.
  if (process.env.NEXT_PUBLIC_DEMO === "1") return <DemoRedirect to="/overview" />;
  redirect("/overview");
}
