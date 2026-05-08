use tauri_plugin_http::reqwest;

/// Returned by `fetch_and_extract_url`.
#[derive(serde::Serialize)]
pub struct FetchedPage {
    pub title: String,
    pub markdown: String,
    pub url: String,
}

/// Fetch a URL and extract its text content as plain Markdown-ish text.
/// Uses tauri-plugin-http's reqwest client so it respects the user's
/// proxy settings (HTTP_PROXY / HTTPS_PROXY env vars set by proxy.rs).
#[tauri::command]
pub async fn fetch_and_extract_url(url: String) -> Result<FetchedPage, String> {
    // Build a client that follows redirects and sets a browser-like UA
    // so sites don't immediately block us.
    let client = reqwest::Client::builder()
        .user_agent(
            "Mozilla/5.0 (compatible; LLMWiki/1.0; +https://github.com/llm-wiki)",
        )
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error fetching {url}: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "HTTP {} fetching {url}",
            response.status().as_u16()
        ));
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();

    if content_type.contains("text/html") || content_type.is_empty() {
        let html = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {e}"))?;
        let (title, markdown) = extract_html(&html);
        Ok(FetchedPage { title, markdown, url })
    } else if content_type.contains("text/") {
        // Plain text / markdown / CSV etc.
        let text = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response body: {e}"))?;
        let title = url
            .rsplit('/')
            .find(|s| !s.is_empty())
            .unwrap_or("Untitled")
            .to_string();
        Ok(FetchedPage {
            title,
            markdown: text,
            url,
        })
    } else {
        Err(format!(
            "Unsupported content type '{content_type}' for URL {url}. Only HTML and plain-text pages are supported."
        ))
    }
}

/// Minimal HTML → plain-text extractor.
/// Strips tags, decodes common entities, collapses whitespace.
/// Good enough for feeding to the LLM without pulling in a full HTML parser crate.
fn extract_html(html: &str) -> (String, String) {
    // 1. Extract <title>
    let title = {
        let lower = html.to_lowercase();
        if let Some(start) = lower.find("<title") {
            if let Some(end_tag) = html[start..].find('>') {
                let after = &html[start + end_tag + 1..];
                if let Some(close) = after.to_lowercase().find("</title>") {
                    strip_tags(&after[..close]).trim().to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    };

    // 2. Remove script / style / nav / footer / header blocks entirely
    let cleaned = remove_blocks(html, &["script", "style", "nav", "footer", "header", "aside", "noscript"]);

    // 3. Strip remaining tags
    let text = strip_tags(&cleaned);

    // 4. Decode common HTML entities
    let decoded = decode_entities(&text);

    // 5. Collapse runs of whitespace / blank lines
    let collapsed = collapse_whitespace(&decoded);

    let final_title = if title.is_empty() {
        // Fall back to first non-empty line
        collapsed
            .lines()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("Untitled")
            .trim()
            .to_string()
    } else {
        title
    };

    (final_title, collapsed)
}

fn remove_blocks(html: &str, tags: &[&str]) -> String {
    let mut result = html.to_string();
    for tag in tags {
        // Case-insensitive block removal
        loop {
            let lower = result.to_lowercase();
            let open_pat = format!("<{tag}");
            let close_pat = format!("</{tag}>");
            match (lower.find(&open_pat), lower.find(&close_pat)) {
                (Some(s), Some(e)) if s <= e => {
                    let end = e + close_pat.len();
                    result = format!("{}{}", &result[..s], &result[end..]);
                }
                _ => break,
            }
        }
    }
    result
}

fn strip_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out
}

fn decode_entities(text: &str) -> String {
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&hellip;", "…")
        .replace("&copy;", "©")
        .replace("&reg;", "®")
        .replace("&trade;", "™")
}

fn collapse_whitespace(text: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut blank_run = 0usize;
    for raw_line in text.lines() {
        let trimmed = raw_line
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if trimmed.is_empty() {
            blank_run += 1;
            // Allow at most one consecutive blank line
            if blank_run == 1 {
                lines.push(String::new());
            }
        } else {
            blank_run = 0;
            lines.push(trimmed);
        }
    }
    // Trim leading/trailing blanks
    while lines.first().map(|l| l.is_empty()).unwrap_or(false) {
        lines.remove(0);
    }
    while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    lines.join("\n")
}
