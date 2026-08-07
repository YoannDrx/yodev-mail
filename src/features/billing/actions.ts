"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { currentWorkspace } from "@/lib/current-workspace";
import { env } from "@/lib/env";
import { isPaidPlan, type PaidPlan } from "@/lib/plans";
import { stripe } from "@/lib/stripe";
const prices:Record<PaidPlan,[string|undefined,string|undefined]>={starter:[env.STRIPE_PRICE_STARTER,env.STRIPE_OVERAGE_STARTER],pro:[env.STRIPE_PRICE_PRO,env.STRIPE_OVERAGE_PRO],agency:[env.STRIPE_PRICE_AGENCY,env.STRIPE_OVERAGE_AGENCY]};
export async function checkoutAction(plan:string){if(!isPaidPlan(plan))throw new Error("Unknown plan");const {workspace}=await currentWorkspace({admin:true});const [base,overage]=prices[plan];if(!base||!overage)throw new Error("Stripe plan is not configured");const [subscription]=await requireDb().select().from(subscriptions).where(eq(subscriptions.workspaceId,workspace.id)).limit(1);const session=await stripe().checkout.sessions.create({mode:"subscription",branding_settings:{background_color:"#F7F5F0",border_style:"rounded",button_color:"#315EFB",display_name:"Mail by Yodev",font_family:"inter"},customer:subscription?.stripeCustomerId??undefined,customer_email:subscription?.stripeCustomerId?undefined:undefined,line_items:[{price:base,quantity:1},{price:overage}],allow_promotion_codes:true,automatic_tax:{enabled:true},subscription_data:{metadata:{workspaceId:workspace.id,plan}},metadata:{workspaceId:workspace.id,plan},success_url:`${env.NEXT_PUBLIC_APP_URL}/dashboard/facturation?checkout=success`,cancel_url:`${env.NEXT_PUBLIC_APP_URL}/tarifs`});redirect(session.url!)}
export async function portalAction(){const {workspace}=await currentWorkspace({admin:true});const [subscription]=await requireDb().select().from(subscriptions).where(eq(subscriptions.workspaceId,workspace.id)).limit(1);if(!subscription?.stripeCustomerId)throw new Error("No Stripe customer");const session=await stripe().billingPortal.sessions.create({customer:subscription.stripeCustomerId,return_url:`${env.NEXT_PUBLIC_APP_URL}/dashboard/facturation`});redirect(session.url)}
