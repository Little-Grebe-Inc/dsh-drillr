<div align="center">

🌐 **English** · [中文](./README.zh-CN.md)

<img src="assets/icon.png" width="96" alt="drillr">

# drillr for DeepSeek Harness

Financial data and research tools for your DeepSeek Harness agent: filings, statements, company discovery, read-only SQL over financial tables, news and research signals for US, Japan and China A-share equities. Every figure is traced to the filing it came from.

</div>

This plugin connects DeepSeek Harness (dsh) to drillr's hosted MCP server (`https://gateway.drillr.ai/mcp/data`) through the **official DSH MCP client**. It adds a **Settings → drillr** page where you save your drillr API key; the key goes into the DSH credential store on your computer, never into a config file or the chat.

## Install

**DSH Desktop:** open **Plugins → Add plugin** and enter `https://github.com/Little-Grebe-Inc/dsh-drillr`, then click **Install**. If you use the community plugin market, you can also search for `drillr` there.

**Command line** (`dsh web` or a custom profile):

```sh
dsh plugin --profile web add github:Little-Grebe-Inc/dsh-drillr
```

The package is plain JavaScript with no build step, so a GitHub install needs no build-script approval. A prebuilt tarball is also attached to every [release](https://github.com/Little-Grebe-Inc/dsh-drillr/releases):

```sh
dsh plugin --profile web add https://github.com/Little-Grebe-Inc/dsh-drillr/releases/latest/download/dsh-drillr.tgz
```

## Set up your key

1. Create an API key at [drillr.ai/account/api-keys](https://drillr.ai/account/api-keys).
2. In DSH open **Settings → drillr**, paste the key and click **Save key**.
3. The page shows **Key: saved** and, a few seconds later, **Tools: connected**.

Then ask the agent, for example:

```text
Use drillr to look up the ticker for Apple
```

A reply with Apple Inc. / AAPL from a `mcp__drillr__ticker_lookup` call confirms the connection.

## Tools

The plugin exposes drillr's ten MCP tools as `mcp__drillr__<tool>`:

| Group | Tool | What it does |
|---|---|---|
| Company | `ticker_lookup` | Resolve a company name or partial ticker to listed tickers |
| Company | `company_search` | Find companies from a plain-language description |
| Filings | `filing_list` | List a company's indexed filings |
| Filings | `filing_search` | Search one company's filings: exact as-reported values and matching filing text |
| Datasets | `list_tables` | Browse the alternative-data table catalog |
| Datasets | `get_table_schema` | Columns and coverage notes of one table |
| Datasets | `run_sql` | Read-only SQL over the financial and alternative-data tables |
| Signal | `news_search` | News stories, events and attributed claims about a company, theme or the market |
| Signal | `industry_inflections` | Industry inflections from structured research of US-listed companies' earnings calls |
| Signal | `ai_adoption` | Concrete enterprise AI applications disclosed in US companies' earnings calls |

Reference for every tool: [drillr.ai/docs/mcp](https://drillr.ai/docs/mcp).

**Coverage.** Core equity coverage is US, Japan (`7203.T`) and China A-shares (`600519.SH` / `000001.SZ`). Some datasets are narrower (for example earnings calls US + Japan, analyst and ownership data US only); `get_table_schema` states each table's coverage.

## How it works

The bundle adds two rows to your profile:

| Row | Package | Role |
|---|---|---|
| `drillr-settings` | `dsh-drillr` | The **Settings → drillr** page and its local routes that save, inspect and remove the `DRILLR_API_KEY` credential |
| `drillr-mcp` | `@deepseek-ai/dsh-mcp-client` | The official MCP client: Streamable HTTP to `https://gateway.drillr.ai/mcp/data` with `Authorization: Bearer ${credential:DRILLR_API_KEY}` |

Until a key is saved, the MCP row waits for the credential instead of failing. Saving, replacing or removing the key takes effect without a restart. You can also provide the key as `DRILLR_API_KEY` in `$DSH_HOME/.env` or in the environment that starts dsh.

drillr also supports browser OAuth for MCP clients that implement it. When the official DSH MCP client ships OAuth, this plugin will switch to browser sign-in.

Tested on DeepSeek Harness Desktop 0.2.2-rc.2 (macOS).

## Privacy

The key is stored only in the DSH credential store on your computer (`$DSH_HOME/.credentials.yaml` by default, readable only by your user). The plugin sends it only to `gateway.drillr.ai`, as the bearer token of MCP requests. drillr's privacy policy: [drillr.ai/privacy](https://drillr.ai/privacy).

## Links

- drillr MCP server and other clients: [Little-Grebe-Inc/drillr-mcp-server](https://github.com/Little-Grebe-Inc/drillr-mcp-server)
- Agent skill with research workflows: [Little-Grebe-Inc/drillr-skill](https://github.com/Little-Grebe-Inc/drillr-skill)
- Issues: [github.com/Little-Grebe-Inc/dsh-drillr/issues](https://github.com/Little-Grebe-Inc/dsh-drillr/issues)

MIT © Little Grebe Inc.
