# Copyright & Attribution

**InstaPilot AI**
Copyright © 2026 **Yati Bhardwaj** ([@ys941](https://github.com/ys941))

Licensed under the [MIT Licence](LICENSE).

---

## The short version

**You may:** use it, run it, self-host it, fork it, modify it, use it commercially,
build a business on it, and re-skin it entirely as your own brand.

**You must:** keep the copyright notice, and keep the author credit visible.

**You may not:** claim you wrote it, or strip the attribution and pass it off as
original work.

That's the whole deal.

---

## ✅ What you are free to do

| | |
|---|---|
| 🏢 **Use it commercially** | Run client channels with it, charge for the service, keep the money. No revenue share, no licence fee, no permission needed. |
| 🎨 **Re-brand it completely** | Change the app name, colours, persona, niche, logo and copy. The product can look entirely like yours — that is what the white-label system is for. |
| 🔧 **Modify anything** | Fork it, rip parts out, bolt parts on. No obligation to contribute changes back (though pull requests are welcome). |
| 📦 **Redistribute it** | Ship it to clients, bundle it, host it for others. |
| 🔒 **Keep your changes private** | This is MIT, not GPL. Your fork does not have to be open source. |

---

## ⭐ What is required in return

### 1. Keep the copyright notice

The MIT licence requires the notice in [`LICENSE`](LICENSE) to travel with the software.
Keep that file in any copy or substantial portion you distribute. This is the legally
binding part.

### 2. Keep the author credit visible

The dashboard footer links to [github.com/ys941](https://github.com/ys941). Everything
*around* that credit is yours to change — the app name above it follows your Brand
settings — but the credit itself should stay.

The server also declines to start until you acknowledge this, by setting:

```bash
ATTRIBUTION_ACK="https://github.com/ys941"
```

Nothing is transmitted anywhere. No network call is made, no telemetry is collected,
no licence server is contacted. The value is compared to a string in
[`lib/attribution.ts`](lib/attribution.ts) and that is all.

> **On honesty:** that check is trivial to delete, and this is an MIT-licensed
> repository, so you would be within your rights to do so. It is a request and a
> speed bump, not enforcement. It costs you a single line in a footer, and it is the
> only thing asked in exchange for several months of work given away for free.
> Please leave it in.

---

## ❌ What is not okay

- **Claiming authorship.** Don't present this as software you wrote.
- **Removing the copyright notice** from copies you distribute — that one is an actual
  licence violation, not just bad manners.
- **Re-uploading it as your own project** with the attribution stripped.
- **Implying endorsement.** Building on this doesn't mean the author endorses, supports
  or is responsible for what you build.

---

## 🌐 What this copyright does *not* cover

This notice and the MIT licence cover **the source code in this repository only**.

They grant no rights to, and carry no warranty regarding:

- **Third-party APIs** the software talks to — Meta (Instagram, Facebook), Google
  (YouTube, Gemini), Groq, Cerebras, Cloudinary, Jamendo, Resend and any other provider
  you configure. Each remains subject to that provider's own terms, and you supply your
  own credentials.
- **Assets fetched at runtime** — music, images and models carry their own licences.
  Jamendo tracks, for example, are Creative Commons and must be credited, as the
  software does by default.
- **Content the software generates and publishes on your behalf.** You are the operator
  of your accounts. You remain responsible for what is posted, for each platform's
  policies, and for any applicable rules on automated posting, advertising and
  disclosure.

See [NOTICE.md](NOTICE.md) for the full detail.

---

## 🩺 Not a medical device

This software performs no medical function and gives no medical advice. Nothing it
produces is a diagnosis, a clinical recommendation, or a substitute for a qualified
clinician.

---

## 📬 Questions

Unsure whether your use is okay? Just ask — the answer is almost always yes.

**ys9410017064@gmail.com** · [github.com/ys941](https://github.com/ys941)

---

<sub>Built after hours by a medical laboratory technologist who learned to code.
If this saved you time, a star costs nothing. ⭐</sub>
