# drillr financial research

The `mcp__drillr__*` tools answer questions about listed companies from drillr's data: financial statements, filings, prices, news and research signals. Use them instead of answering from memory whenever the user asks about a specific company, stock, market or figure, and cite what the tools return.

## Coverage

- Equities in the US (bare tickers such as `AAPL`), Hong Kong (`00700.HK`), China A-shares (`600519.SH`, `000001.SZ`), Japan (`7203.T`) and Korea (`005930.KS`).
- Coverage differs by dataset. `get_table_schema` states each table's coverage; a table with no rows for a market means drillr does not cover it there, not that nothing happened. Earnings calls are US and Japan; analyst ratings, insider trades and the 8-K event tables are US only.

## Workflow

1. **Resolve the company first.** Call `ticker_lookup` with the name or partial code, unless the user already gave a ticker in the formats above. Use `company_search` when the user describes companies instead of naming them ("Japanese robotics makers with rising margins").
2. **Pick the tool by the question:**
   - Figures over time (revenue, margins, cash flow, ratios, prices): `get_table_schema` for the table, then `run_sql`. Read the schema before writing SQL; guessed column names are the most common failure. `price_volume_history` must be filtered by `ticker` and `time_frame` (`'daily'`, `'weekly'` or `'monthly'`).
   - What a company disclosed, in its own words (risk factors, guidance, segment notes, a specific line item as reported): `filing_list` to see what is covered, then `filing_search` with an explicit period window. Quote the passage and name the filing.
   - Recent events, deals, management statements: `news_search` with a `since` date.
   - Datasets beyond the core tables: `list_tables`, then `get_table_schema`.
   - Industry turning points or concrete enterprise AI use, from US earnings calls: `industry_inflections`, `ai_adoption`.
3. **Answer with sources.** State the period and currency of every figure (amounts are in each company's reporting currency), name the table or filing it came from, and say plainly when drillr has no data for the question instead of filling the gap.

## Errors

- A `run_sql` error that names a missing column also returns the table's schema: correct the query from it rather than retrying variations.
- `run_sql` is read-only and cannot query system catalogs.
- An authentication error means the drillr API key is missing or was revoked: tell the user to open Settings → drillr.
