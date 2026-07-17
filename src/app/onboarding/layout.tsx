import { requirePageUser } from "@/lib/page-auth";
export default async function OnboardingLayout({children}:{children:React.ReactNode}){await requirePageUser();return children}
