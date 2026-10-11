"use client";

import { useActionState } from "react";
import { Link2, UserPlus, Users } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { FieldError, FormStatus } from "@/components/form-status";
import { InvitationLinkBox } from "@/components/auth/invitation-link-box";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  cancelMemberInvitationAction,
  copyMemberInvitationLinkAction,
  inviteMemberAction,
  removeMemberAction,
  type MemberActionState,
} from "@/features/members/actions";
import { initialActionState } from "@/lib/action-state";
import { localized, type Locale } from "@/i18n/config";

export type MemberRow = { id: string; name: string; email: string; isOwner: boolean; isSelf: boolean };
export type InvitationRow = { id: string; email: string; validUntil: string };

type PanelState = MemberActionState & { sequence: number };

const actions = {
  invite: inviteMemberAction,
  link: copyMemberInvitationLinkAction,
  remove: removeMemberAction,
  revoke: cancelMemberInvitationAction,
} as const;

// One result for the whole panel: only the latest outcome (and link) is shown,
// and every control is disabled while any change is running.
async function membersAction(previous: PanelState, formData: FormData): Promise<PanelState> {
  const intent = formData.get("intent");
  const action = typeof intent === "string" && intent in actions ? actions[intent as keyof typeof actions] : null;
  if (!action) return previous;
  return { ...(await action(previous, formData)), sequence: previous.sequence + 1 };
}

export function MembersPanel({
  canManage,
  invitations,
  locale,
  members,
  seatsFull,
  workspaceApproved,
}: {
  canManage: boolean;
  invitations: InvitationRow[];
  locale: Locale;
  members: MemberRow[];
  seatsFull: boolean;
  workspaceApproved: boolean;
}) {
  const copy = localized(locale, {
    fr: { email: "Email du membre", invite: "Inviter", inviting: "Invitation…", owner: "propriétaire", member: "membre", remove: "Retirer", removeTitle: "Retirer ce membre ?", removeText: (name: string) => `${name} perdra immédiatement l’accès au workspace. Vous pourrez l’inviter à nouveau plus tard.`, removing: "Retrait…", cancel: "Annuler", validUntil: "Invitation valable jusqu’au", waiting: "en attente", revoke: "Révoquer", revokeTitle: "Révoquer cette invitation ?", revokeText: "Le lien d’invitation cessera de fonctionner et la place sera libérée.", revoking: "Révocation…", copyLink: "Obtenir le lien", notApproved: "Les invitations s’ouvrent dès que Yodev a approuvé votre workspace.", seatsFull: "Toutes les places sont occupées : révoquez une invitation ou retirez un membre pour inviter quelqu’un d’autre.", readOnly: "Seuls le propriétaire et les administrateurs du workspace peuvent inviter ou retirer des membres." },
    en: { email: "Member email", invite: "Invite", inviting: "Inviting…", owner: "owner", member: "member", remove: "Remove", removeTitle: "Remove this member?", removeText: (name: string) => `${name} will immediately lose access to the workspace. You can invite them again later.`, removing: "Removing…", cancel: "Cancel", validUntil: "Invitation valid until", waiting: "pending", revoke: "Revoke", revokeTitle: "Revoke this invitation?", revokeText: "The invitation link will stop working and the seat will be released.", revoking: "Revoking…", copyLink: "Get link", notApproved: "Invitations open once Yodev has approved your workspace.", seatsFull: "All seats are taken: revoke an invitation or remove a member to invite someone else.", readOnly: "Only the workspace owner and administrators can invite or remove members." },
  });
  const [state, dispatch, pending] = useActionState(membersAction, { ...initialActionState(), sequence: 0 } as PanelState);
  const inviteDisabled = !workspaceApproved || seatsFull || pending;
  const inviteBlocker = !workspaceApproved ? copy.notApproved : seatsFull ? copy.seatsFull : "";
  const describedBy = [state.fieldErrors.email ? "invite-email-error" : "", inviteBlocker ? "invite-blocker" : ""].filter(Boolean).join(" ");

  return (
    <div className="grid gap-4">
      {canManage ? (
        <section className="grid gap-3 rounded-md border bg-card p-5">
          <form action={dispatch} className="flex flex-col gap-2 sm:flex-row sm:items-start" noValidate>
            <input name="intent" type="hidden" value="invite" />
            <div className="grid flex-1 gap-1">
              <Input
                aria-describedby={describedBy || undefined}
                aria-invalid={state.fieldErrors.email ? true : undefined}
                aria-label={copy.email}
                defaultValue={state.values.email ?? ""}
                disabled={inviteDisabled}
                key={state.sequence}
                maxLength={320}
                name="email"
                placeholder="member@example.com"
                required
                type="email"
              />
              <FieldError errors={state.fieldErrors.email} id="invite-email-error" />
            </div>
            <Button disabled={inviteDisabled} type="submit"><UserPlus />{pending ? copy.inviting : copy.invite}</Button>
          </form>
          {inviteBlocker ? <p className="text-sm text-muted-foreground" id="invite-blocker">{inviteBlocker}</p> : null}
          <FormStatus message={state.message} ok={state.ok} />
          {state.data?.link ? <InvitationLinkBox link={state.data.link} locale={locale} /> : null}
        </section>
      ) : (
        <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">{copy.readOnly}</p>
      )}

      {members.map((member) => (
        <article className="flex flex-wrap items-center justify-between gap-4 rounded-md border bg-card p-5" key={member.id}>
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-md bg-violet-100 text-primary"><Users className="size-5" /></div>
            <div><p className="font-medium">{member.name}</p><p className="text-sm text-muted-foreground">{member.email}</p></div>
            <Badge variant={member.isOwner ? "default" : "secondary"}>{member.isOwner ? copy.owner : copy.member}</Badge>
          </div>
          {canManage && !member.isOwner && !member.isSelf ? (
            <ConfirmAction
              action={dispatch}
              cancelLabel={copy.cancel}
              confirmLabel={copy.remove}
              description={copy.removeText(member.name || member.email)}
              disabled={pending}
              fields={{ intent: "remove", memberId: member.id }}
              pendingLabel={copy.removing}
              title={copy.removeTitle}
              trigger={copy.remove}
              triggerVariant="destructive"
            />
          ) : null}
        </article>
      ))}

      {invitations.map((invitation) => (
        <article className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-dashed bg-card p-5" key={invitation.id}>
          <div><p className="font-medium">{invitation.email}</p><p className="text-sm text-muted-foreground">{copy.validUntil} {invitation.validUntil}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{copy.waiting}</Badge>
            {canManage ? (
              <>
                <form action={dispatch}>
                  <input name="intent" type="hidden" value="link" />
                  <input name="invitationId" type="hidden" value={invitation.id} />
                  <Button disabled={pending} size="sm" type="submit" variant="outline"><Link2 />{copy.copyLink}</Button>
                </form>
                <ConfirmAction
                  action={dispatch}
                  cancelLabel={copy.cancel}
                  confirmLabel={copy.revoke}
                  description={copy.revokeText}
                  disabled={pending}
                  fields={{ intent: "revoke", invitationId: invitation.id }}
                  pendingLabel={copy.revoking}
                  title={copy.revokeTitle}
                  trigger={copy.revoke}
                />
              </>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}
