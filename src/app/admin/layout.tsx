import { requireAdmin } from "@/lib/page-auth";
export default async function AdminLayout({children}:{children:React.ReactNode}){await requireAdmin();return children}
