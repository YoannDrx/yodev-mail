import type { DeliveryProvider, EmailProviderName } from "@/features/providers/types";
import { PostmarkDeliveryProvider } from "@/features/providers/postmark";
import { SesDeliveryProvider } from "@/features/providers/ses";

const providers: Record<EmailProviderName, DeliveryProvider> = {
  postmark: new PostmarkDeliveryProvider(),
  ses: new SesDeliveryProvider(),
};

export function deliveryProvider(name: EmailProviderName) {
  return providers[name];
}
