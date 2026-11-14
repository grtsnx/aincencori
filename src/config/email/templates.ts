import { html, type SafeHtml } from '@nestjs/mail';

// Every email the app sends. Variables are escaped by the html`` tag.
export type EmailTemplate =
  | 'sign-in-otp'
  | 'verify-email-otp'
  | 'reset-password-otp'
  | 'two-factor'
  | 'invitation'
  | 'alert'
  | 'renewal-reminder'
  | 'notification';

export interface RenderedEmail {
  subject: string;
  html: SafeHtml;
  text: string;
}

type Variables = Record<string, string>;

function codeEmail(
  subject: string,
  intro: string,
  v: Variables,
): RenderedEmail {
  const minutes = v.expirationMinutes ?? '5';
  return {
    subject,
    html: html`<p>${intro}</p>
      <p style="font-size:28px;letter-spacing:6px">
        <strong>${v.otpCode}</strong>
      </p>
      <p>
        The code expires in ${minutes} minutes. If you didn't ask for it, ignore
        this email.
      </p>
      <p>${v.appName}</p>`,
    text: `${intro}\n\n${v.otpCode}\n\nThe code expires in ${minutes} minutes. If you didn't ask for it, ignore this email.\n\n${v.appName}`,
  };
}

export function renderEmail(
  template: EmailTemplate,
  v: Variables,
): RenderedEmail {
  switch (template) {
    case 'sign-in-otp':
      return codeEmail(
        `Your ${v.appName} sign-in code`,
        'Use this code to sign in:',
        v,
      );
    case 'verify-email-otp':
      return codeEmail(
        `Confirm your email for ${v.appName}`,
        'Use this code to confirm your email:',
        v,
      );
    case 'reset-password-otp':
      return codeEmail(
        `Your ${v.appName} reset code`,
        'Use this code to reset your password:',
        v,
      );
    case 'two-factor':
      return codeEmail(
        `Your ${v.appName} security code`,
        'Use this code to finish signing in:',
        v,
      );
    case 'invitation':
      return {
        subject: `${v.inviterName} invited you to ${v.organizationName}`,
        html: html`<p>
            ${v.inviterName} (${v.inviterEmail}) invited you to join
            <strong>${v.organizationName}</strong> on ${v.appName} as ${v.role}.
          </p>
          <p><a href="${v.inviteLink}">Accept the invite</a></p>
          <p>If you weren't expecting this, ignore this email.</p>`,
        text: `${v.inviterName} (${v.inviterEmail}) invited you to join ${v.organizationName} on ${v.appName} as ${v.role}.\n\nAccept the invite: ${v.inviteLink}\n\nIf you weren't expecting this, ignore this email.`,
      };
    // Something the user pays for ends soon and will not renew by itself.
    case 'renewal-reminder':
      return {
        subject: `${v.what} ends on ${v.endsOn}`,
        html: html`<p>Hi ${v.name},</p>
          <p>
            Your ${v.what} on ${v.appName} ends on <strong>${v.endsOn}</strong>.
          </p>
          <p>${v.action}</p>
          <p><a href="${v.link}">Keep it going</a></p>`,
        text: `Hi ${v.name},\n\nYour ${v.what} on ${v.appName} ends on ${v.endsOn}.\n\n${v.action}\n\nKeep it going: ${v.link}`,
      };
    // A notification the user chose to get by email (see config/notifications).
    case 'notification':
      return {
        subject: v.title,
        html: html`<p>${v.body}</p>
          <p><a href="${v.link}">Open ${v.appName}</a></p>
          <p style="color:#666;font-size:12px">
            You can choose which notifications you get by email in your
            settings.
          </p>`,
        text: `${v.body}\n\nOpen ${v.appName}: ${v.link}\n\nYou can choose which notifications you get by email in your settings.`,
      };
    // For admins: something broke. Users only saw a plain message.
    case 'alert':
      return {
        subject: `[${v.appName}] ${v.title}`,
        html: html`<p><strong>${v.title}</strong></p>
          <p>Where: ${v.source}</p>
          <pre style="white-space:pre-wrap">${v.detail}</pre>
          <p>
            Users were shown a plain message. More alerts like this in the next
            10 minutes are counted, not emailed.
          </p>`,
        text: `${v.title}\n\nWhere: ${v.source}\n\n${v.detail}\n\nUsers were shown a plain message. More alerts like this in the next 10 minutes are counted, not emailed.`,
      };
  }
}
