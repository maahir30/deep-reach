# deep-reach

AI-powered cold outreach for job seekers. Find companies, discover contacts, and generate personalized emails -- all from the command line.

Built on [LangGraph DeepAgents](https://github.com/langchain-ai/langgraphjs) with Claude, Hunter.io, and Tavily.

## Quick Start

```bash
npx deep-reach init       # one-time setup (profile, resume, API keys)
npx deep-reach run        # find companies, contacts, and draft emails
npx deep-reach send run0001   # send the emails
```

## Setup

### 1. Initialize your workspace

```bash
mkdir my-outreach && cd my-outreach
npx deep-reach init
```

The wizard walks you through everything:
- Your name, email, LinkedIn, GitHub
- Target roles, industries, locations
- Resume (PDF and optional Markdown)
- API keys

It creates a `.deep-reach/` directory with your config and a `.env` with your keys.

### 2. Get your API keys

You'll need three API keys (the wizard will prompt for each):

| Key | What it does | Get it here |
|-----|-------------|-------------|
| `ANTHROPIC_API_KEY` | Powers the AI (Claude) | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) |
| `HUNTER_API_KEY` | Finds email addresses at companies | [hunter.io/api-keys](https://hunter.io/api-keys) |
| `TAVILY_API_KEY` | Web search for company/contact research | [app.tavily.com/home](https://app.tavily.com/home) |

### 3. Gmail setup (optional, for sending)

Only needed if you want to send emails with `--send` or the `send` command.

1. Enable **2-Step Verification** on your Google Account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Select **Mail** and generate a password
4. Copy the 16-character password (format: `xxxx-xxxx-xxxx-xxxx`)

The wizard will prompt for `GMAIL_USER` and `GMAIL_APP_PASSWORD`. If you skip them during init, you can add them later:

```bash
npx deep-reach edit env
```

## Commands

### `deep-reach init`

Interactive setup wizard. Creates your workspace in the current directory.

```bash
npx deep-reach init
```

### `deep-reach run`

Run the outreach pipeline. Finds companies, discovers contacts, drafts personalized emails.

```bash
npx deep-reach run                                    # use defaults
npx deep-reach run --prompt "Focus on AI startups"    # steer the search
npx deep-reach run --dry-run                          # validate only, don't run
npx deep-reach run --send                             # auto-send after drafting
npx deep-reach run --yes                              # skip confirmation
npx deep-reach run --verbose                          # detailed logging
npx deep-reach run --profile ./other-profile          # use a different profile dir
npx deep-reach run --dir ~/other-workspace            # use a different workspace
```

### `deep-reach send <run-id>`

Send emails from a previous run's drafts.

```bash
npx deep-reach send run0001           # review recipients, then send
npx deep-reach send run0001 --yes     # skip confirmation
```

### `deep-reach edit <target>`

Open a config file for editing. Opens with your OS default application.

```bash
npx deep-reach edit profile       # edit name, email, links
npx deep-reach edit preferences   # edit roles, industries, tone, limits
npx deep-reach edit resume        # open resume folder (drag-drop PDF, edit markdown)
npx deep-reach edit env           # edit API keys
```

## Editing Your Config

All your config lives in `.deep-reach/` inside your workspace. You can edit these files however you like -- through `deep-reach edit`, or by opening them directly in any editor.

**profile.json** -- who you are:
```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "linkedinUrl": "https://linkedin.com/in/janedoe",
  "githubUrl": "https://github.com/janedoe",
  "interests": ["AI/ML", "Backend Infrastructure"]
}
```

**preferences.json** -- run defaults:
```json
{
  "defaultRoles": ["Software Engineering Intern", "ML Engineering Intern"],
  "defaultLocations": ["San Francisco", "Remote"],
  "defaultIndustries": ["AI/ML", "Developer Tools", "Fintech"],
  "defaultTone": "professional",
  "defaultMaxOutreachPerRun": 10,
  "defaultContactsPerCompany": 5,
  "hardExclusions": []
}
```

Valid tones: `"professional"`, `"casual"`, `"enthusiastic"`.

**resume/** -- your resume files:
- `resume.pdf` -- attached to outgoing emails
- `resume.md` -- read by the AI to personalize email drafts (optional but recommended)

If you update your resume, just replace the files in `.deep-reach/resume/`.

## How It Works

When you run `deep-reach run`, the AI pipeline:

1. **Checks history** -- reads `storage/contacted.json` to avoid companies you've already emailed
2. **Finds companies** -- searches the web for companies matching your preferences
3. **Human review** -- shows you the list and asks for approval (you can reject and give feedback)
4. **Processes companies in parallel** -- for each approved company:
   - Researches the company
   - Finds contacts via Hunter.io
   - Researches each contact individually
   - Drafts a personalized email using your resume and their background
5. **Saves everything** -- drafts go to `runs/<run-id>/drafts.json`
6. **Updates history** -- adds successful companies to `storage/contacted.json`

You review the drafts, then send with `deep-reach send <run-id>`.

## Workspace Structure

```
my-outreach/
├── .deep-reach/              # your config (created by init)
│   ├── profile.json          # identity
│   ├── preferences.json      # run defaults
│   └── resume/
│       ├── resume.pdf        # attached to emails
│       └── resume.md         # AI reads this for personalization
├── .env                      # API keys (gitignored)
├── runs/                     # created automatically per run
│   └── run0001/
│       ├── config.json       # snapshot of run config + profile
│       ├── companies.json    # companies found and processed
│       ├── contacts/         # contacts per company
│       │   └── stripe.json
│       └── drafts.json       # email drafts with send status
└── storage/                  # persistent across runs
    ├── contacted.json        # companies already emailed
    └── suppression_list.json # blocked domains/emails
```

## Workspace Discovery

You can run `deep-reach` from anywhere inside your workspace directory tree. The tool walks up from your current directory looking for `.deep-reach/`, similar to how `git` finds `.git/`.

```bash
cd ~/my-outreach                    # works
cd ~/my-outreach/runs/run0001       # also works
cd ~/my-outreach/storage            # also works
```

To use a specific workspace from anywhere:

```bash
npx deep-reach run --dir ~/my-outreach
```

## Requirements

- Node.js >= 18
- API keys: Anthropic, Hunter.io, Tavily
- Gmail App Password (only for sending)

## License

MIT
