# Copyright & Attribution

**InstaPilot AI**
Copyright © 2026 **Yati Bhardwaj** ([@ys941](https://github.com/ys941))

Licensed under the [MIT Licence](LICENSE), with the visible-credit attribution
requirement described below (the app checks it at startup).

---

## The short version

**You may:** use it, run it, self-host it, fork it, modify it, use it commercially,
build a business on it, and re-skin it entirely as your own brand.

**You must:** keep the copyright notice (an MIT licence condition), and keep the
author credit visible (this project's attribution requirement, checked at startup).

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

The licence requires the notice in [`LICENSE`](LICENSE) to travel with the software.
Keep that file in any copy or substantial portion you distribute.

### 2. Keep the author credit visible

**This is the project's attribution requirement, not a courtesy.** Any deployment other
people can see must display legible credit to the author:

> Built by Yati Bhardwaj — https://github.com/ys941

The dashboard footer does this for you out of the box. Everything *around* it is yours
to change — the app name above it follows your Brand settings — but the credit itself
must stay, and the link must keep working.

The server also declines to start unless **both** are true:

```bash
ATTRIBUTION_ACK="https://github.com/ys941"   # set in your environment
```

...and the footer still contains the credit. Removing it stops the app from booting.

Nothing is transmitted anywhere. No network call is made, no telemetry is collected,
no licence server is contacted. The value is compared to a string in
[`lib/attribution.ts`](lib/attribution.ts) and that is all.

> **A note on the check:** it is easy to delete, and you are free to modify this
> code. But the attribution requirement stands regardless of whether
> the check is present — removing the check does not remove the obligation, it just
> means the software stops reminding you of it.

---

## ❌ What is not okay

- **Claiming authorship.** Don't present this as software you wrote.
- **Removing the copyright notice or the visible credit.** The first violates the
  licence, the second violates this project's attribution requirement — neither is
  just bad manners.
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
