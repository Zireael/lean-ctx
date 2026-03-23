use std::sync::Arc;
use tokio::sync::RwLock;

use crate::core::cache::SessionCache;

pub mod ctx_read;
pub mod ctx_tree;
pub mod ctx_shell;
pub mod ctx_search;
pub mod ctx_compress;
pub mod ctx_benchmark;
pub mod ctx_metrics;
pub mod ctx_analyze;

pub type SharedCache = Arc<RwLock<SessionCache>>;

#[derive(Clone)]
pub struct LeanCtxServer {
    pub cache: SharedCache,
    pub tool_calls: Arc<RwLock<Vec<ToolCallRecord>>>,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct ToolCallRecord {
    pub tool: String,
    pub original_tokens: usize,
    pub saved_tokens: usize,
    pub mode: Option<String>,
}

impl LeanCtxServer {
    pub fn new() -> Self {
        Self {
            cache: Arc::new(RwLock::new(SessionCache::new())),
            tool_calls: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub async fn record_call(&self, tool: &str, original: usize, saved: usize, mode: Option<String>) {
        let mut calls = self.tool_calls.write().await;
        calls.push(ToolCallRecord {
            tool: tool.to_string(),
            original_tokens: original,
            saved_tokens: saved,
            mode,
        });

        let output_tokens = original.saturating_sub(saved);
        crate::core::stats::record(tool, original, output_tokens);
    }
}

pub fn create_server() -> LeanCtxServer {
    LeanCtxServer::new()
}
