# Unfilter the HR

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=<YOUR_REPO_URL>&project-name=unfilter-the-hr&repo-name=unfilter-the-hr)

A playful web app that turns corporate HR jargon into blunt, plain-English translations. Built with **HTML + JavaScript** frontend and a **serverless API** backend powered by **OpenAI** and **Airtable**.

---

## Features
- Clean, pill‑shaped input for entering corporate phrases.
- Translations generated live via OpenAI.
- Each query and result stored in Airtable for reference.
- Deployed easily on **Vercel** or **Netlify**.
- Responsive, styled to match Personio’s marketing brand look.

---

## Project Structure
```
├── index.html             # Frontend UI
├── api/translate.js       # Vercel serverless function (backend)
├── netlify/functions/     # Netlify serverless function option
│   └── translate.mjs
├── netlify.toml           # Netlify config
├── package.json           # Project metadata
├── .gitignore             # Git ignore rules
├── LICENSE                # MIT license
└── README.md              # This file
```

---

## Local Setup

1. **Clone the repo**:
   ```bash
   git clone <YOUR_REPO_URL>
   cd unfilter-the-hr
   ```

2. **Install Vercel CLI (optional for local testing)**:
   ```bash
   npm install -g vercel
   ```

3. **Environment variables** (create a `.env.local` file):
   ```bash
   OPENAI_API_KEY=sk-...
   AIRTABLE_TOKEN=pat...
   AIRTABLE_BASE_ID=apprxccvde502eS4C
   AIRTABLE_TABLE_ID=tbltmqLNqQYKykfP7
   MODEL=gpt-4o-mini
   ```

4. **Run locally**:
   ```bash
   vercel dev
   ```
   Then open http://localhost:3000

---

## Deployment

### Vercel
1. Create a free [Vercel](https://vercel.com/signup) account.
2. Import this repo.
3. Add environment variables in **Project Settings → Environment Variables**.
4. Click **Deploy**.

### Netlify
1. Create a free [Netlify](https://app.netlify.com/signup) account.
2. Import this repo.
3. Add environment variables in **Site settings → Environment variables**.
4. Deploy. The function will be available at `/api/translate`.

---

## License

MIT © Kevin Jones
