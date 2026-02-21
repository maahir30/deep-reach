# deepreach

AI-powered cold outreach for job seekers. Find companies, discover contacts, and generate personalized emails — all from the command line.

Built on [deepagents](https://github.com/langchain-ai/deepagentsjs) with Hunter.io and Tavily.

## Getting Started

### 1. Get your API keys

| Key | What it does | Get it here |
|-----|-------------|-------------|
| LLM provider key (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) | Powers the AI agent | Your provider's dashboard (see below) |
| `HUNTER_API_KEY` | Finds email addresses at companies | [hunter.io](https://hunter.io/api-keys) |
| `TAVILY_API_KEY` | Web search for company/contact research | [app.tavily.com](https://app.tavily.com/home) |

Any LLM provider supported by [LangChain](https://docs.langchain.com/oss/javascript/langchain/overview) works. Pass `--model provider:model-name` to the `run` command (e.g. `--model openai:gpt-4o`). Common providers:

| Provider | Env variable | Dashboard |
|----------|-------------|-----------|
| Anthropic | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| OpenAI | `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Google Vertex AI | `GOOGLE_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) |
| Groq | `GROQ_API_KEY` | [console.groq.com](https://console.groq.com/keys) |
| Mistral | `MISTRAL_API_KEY` | [console.mistral.ai](https://console.mistral.ai/api-keys) |

Defaults to Anthropic Claude if no `--model` flag or `CHAT_MODEL` env variable is set.

### 2. Initialize and run

```bash
npx deepreach               # one-time setup (profile, resume, API keys)
npx deepreach run            # find companies, contacts, and draft emails
npx deepreach send run0001   # review and send the drafts
```

The setup wizard walks you through your profile, target roles/industries, resume, and API keys. Everything is saved to a `.deepreach/` directory in your workspace.

## Commands

| Command | Description |
|---------|-------------|
| `deepreach` | Interactive setup wizard (same as `deepreach init`) |
| `deepreach run` | Find companies, discover contacts, draft emails |
| `deepreach send <run-id>` | Send emails from a previous run |
| `deepreach edit <target>` | Edit config (`profile`, `preferences`, `resume`, `env`) |

Run any command with `--help` for all available options.

## How It Works

1. **Finds companies** matching your preferences via web search
2. **Shows you the list** for approval (you can reject and give feedback)
3. **Processes each company** in parallel — researches the company, finds contacts via Hunter.io, and drafts personalized emails using your resume and their background
4. **Saves drafts** to `runs/<run-id>/drafts.json` for review before sending

Previously contacted companies are tracked in `storage/contacted.json` and automatically skipped.

## Gmail Setup (for sending)

Only needed if you want to send emails with `deepreach send`.

1. Enable **2-Step Verification** on your Google Account
2. Generate an App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
3. Add `GMAIL_USER` and `GMAIL_APP_PASSWORD` via `npx deepreach edit env`

## Workspace Structure

```
my-outreach/
├── .deepreach/              # config (created by init)
│   ├── profile.json
│   ├── preferences.json
│   └── resume/
│       ├── resume.pdf       # attached to emails
│       └── resume.md        # AI reads this for personalization
├── .env                     # API keys (gitignored)
├── runs/                    # one folder per run
│   └── run0001/
│       ├── config.json
│       ├── companies.json
│       ├── contacts/
│       └── drafts.json
└── storage/                 # persistent across runs
    ├── contacted.json
    └── suppression_list.json
```

## Requirements

- Node.js >= 22
- API keys: an LLM provider (Anthropic, OpenAI, etc.), Hunter.io, Tavily
- Gmail App Password (only for sending)

## License

MIT
