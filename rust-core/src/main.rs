use clap::Parser;
use serde::Serialize;
use std::process::ExitCode;

/// Supported (source_protocol, target_protocol) migration pairs.
/// This is the policy boundary: MigrateX only ever proposes a migration
/// route that is explicitly whitelisted here.
///
/// aave-v3 -> aave-v4 was dropped: confirmed with a live KeeperHub
/// INVALID_FIELD_TYPE error that aave-v4 actions are registered
/// mainnet-only (chain "1") there -- there is no aave-v4 execution path
/// on Sepolia today. uniswap-v3 -> uniswap-v4 was dropped earlier for the
/// same reason (zero registered KeeperHub actions for "uniswap-v4").
/// morpho -> morpho was dropped after on-chain inspection showed the one
/// Sepolia Morpho Blue deployment this project found had never had a
/// market successfully created on it (every createMarket/supply/borrow
/// call in its history reverted -- its owner never enabled any IRM or
/// LLTV). aave-v3 -> aave-v3 is the only supported pair: verified live
/// (real bytecode, a real WETH reserve with ~12,209 WETH liquidity,
/// 49/50 of its most recent transactions succeeding).
const SUPPORTED_PAIRS: &[(&str, &str)] = &[("aave-v3", "aave-v3")];

/// Basis points of the source amount an operator is willing to lose to
/// slippage/rounding across withdraw -> supply before the post-migration
/// balance check is allowed to flag failure.
const DEFAULT_SLIPPAGE_BPS: u64 = 50; // 0.50%

#[derive(Parser, Debug)]
#[command(
    name = "p-token-migrator",
    about = "Computes a deterministic token migration plan for MigrateX / KeeperHub execution"
)]
struct Args {
    /// Source protocol identifier. Only "aave-v3" is supported.
    #[arg(long)]
    source_protocol: String,

    /// Target protocol identifier. Only "aave-v3" is supported.
    #[arg(long)]
    target_protocol: String,

    /// Token symbol being migrated, e.g. WETH
    #[arg(long)]
    token: String,

    /// Amount to migrate, in human units (decimal string, e.g. "0.005")
    #[arg(long)]
    amount: String,

    /// Chain ID as a string, e.g. 11155111 (Sepolia)
    #[arg(long)]
    network: String,

    /// Address holding the source position
    #[arg(long)]
    source_address: String,

    /// Address that should end up holding the target position
    #[arg(long)]
    recipient_address: String,

    /// Minimum source balance required to proceed.
    /// Defaults to `amount` if not supplied.
    #[arg(long)]
    threshold: Option<String>,

    /// Slippage tolerance in basis points for the post-migration balance
    /// check. Defaults to 50 bps (0.50%).
    #[arg(long, default_value_t = DEFAULT_SLIPPAGE_BPS)]
    slippage_bps: u64,

    /// Emit the migration plan as JSON on stdout (machine-readable, for
    /// the TypeScript orchestrator). Without this flag, prints a
    /// human-readable summary instead.
    #[arg(long)]
    output_plan: bool,
}

#[derive(Serialize, Debug)]
struct MigrationPlan {
    source_protocol: String,
    target_protocol: String,
    token: String,
    amount: String,
    network: String,
    source_address: String,
    recipient_address: String,
    /// Minimum source balance required before withdrawal proceeds.
    threshold: String,
    /// Minimum acceptable destination balance after migration, i.e.
    /// amount minus slippage_bps, used by the post-migration verification.
    min_expected_target_amount: String,
    slippage_bps: u64,
}

#[derive(Debug)]
enum PlanError {
    UnsupportedPair(String, String),
    InvalidAmount(String),
    InvalidAddress(&'static str, String),
    InvalidNetwork(String),
}

impl std::fmt::Display for PlanError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PlanError::UnsupportedPair(s, t) => write!(
                f,
                "unsupported migration pair: {s} -> {t}. Supported pairs: {}",
                SUPPORTED_PAIRS
                    .iter()
                    .map(|(a, b)| format!("{a}->{b}"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            PlanError::InvalidAmount(a) => write!(f, "invalid amount: '{a}' (must be a positive decimal number)"),
            PlanError::InvalidAddress(field, v) => write!(f, "invalid {field}: '{v}' (expected 0x-prefixed 40 hex chars)"),
            PlanError::InvalidNetwork(n) => write!(f, "invalid network: '{n}' (must be a numeric chain id)"),
        }
    }
}

fn is_hex_address(s: &str) -> bool {
    s.len() == 42 && s.starts_with("0x") && s[2..].chars().all(|c| c.is_ascii_hexdigit())
}

fn parse_decimal_amount(s: &str) -> Result<f64, PlanError> {
    let v: f64 = s.parse().map_err(|_| PlanError::InvalidAmount(s.to_string()))?;
    if !v.is_finite() || v <= 0.0 {
        return Err(PlanError::InvalidAmount(s.to_string()));
    }
    Ok(v)
}

fn build_plan(args: &Args) -> Result<MigrationPlan, PlanError> {
    let pair_ok = SUPPORTED_PAIRS
        .iter()
        .any(|(s, t)| *s == args.source_protocol && *t == args.target_protocol);
    if !pair_ok {
        return Err(PlanError::UnsupportedPair(
            args.source_protocol.clone(),
            args.target_protocol.clone(),
        ));
    }

    let amount = parse_decimal_amount(&args.amount)?;

    if args.network.trim().parse::<u64>().is_err() {
        return Err(PlanError::InvalidNetwork(args.network.clone()));
    }

    if !is_hex_address(&args.source_address) {
        return Err(PlanError::InvalidAddress("source_address", args.source_address.clone()));
    }
    if !is_hex_address(&args.recipient_address) {
        return Err(PlanError::InvalidAddress(
            "recipient_address",
            args.recipient_address.clone(),
        ));
    }

    let threshold = match &args.threshold {
        Some(t) => parse_decimal_amount(t)?,
        None => amount,
    };

    let min_expected_target_amount = amount * (1.0 - (args.slippage_bps as f64 / 10_000.0));

    Ok(MigrationPlan {
        source_protocol: args.source_protocol.clone(),
        target_protocol: args.target_protocol.clone(),
        token: args.token.clone(),
        amount: format!("{amount}"),
        network: args.network.clone(),
        source_address: args.source_address.clone(),
        recipient_address: args.recipient_address.clone(),
        threshold: format!("{threshold}"),
        min_expected_target_amount: format!("{min_expected_target_amount}"),
        slippage_bps: args.slippage_bps,
    })
}

fn main() -> ExitCode {
    let args = Args::parse();

    match build_plan(&args) {
        Ok(plan) => {
            if args.output_plan {
                println!("{}", serde_json::to_string_pretty(&plan).unwrap());
            } else {
                println!(
                    "Migration plan: {} {} on chain {} within aave-v3 for {} (recipient {}), threshold {}, min expected target {}",
                    plan.amount,
                    plan.token,
                    plan.network,
                    plan.source_address,
                    plan.recipient_address,
                    plan.threshold,
                    plan.min_expected_target_amount,
                );
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_args() -> Args {
        Args {
            source_protocol: "aave-v3".into(),
            target_protocol: "aave-v3".into(),
            token: "WETH".into(),
            amount: "0.005".into(),
            network: "11155111".into(),
            source_address: format!("0x{}", "11".repeat(20)),
            recipient_address: format!("0x{}", "22".repeat(20)),
            threshold: None,
            slippage_bps: DEFAULT_SLIPPAGE_BPS,
            output_plan: true,
        }
    }

    #[test]
    fn rejects_unsupported_pair() {
        let mut a = valid_args();
        a.source_protocol = "morpho".into();
        a.target_protocol = "morpho".into();
        assert!(matches!(build_plan(&a), Err(PlanError::UnsupportedPair(_, _))));
    }

    #[test]
    fn rejects_aave_v4_pair() {
        let mut a = valid_args();
        a.target_protocol = "aave-v4".into();
        assert!(matches!(build_plan(&a), Err(PlanError::UnsupportedPair(_, _))));
    }

    #[test]
    fn rejects_bad_address() {
        let mut a = valid_args();
        a.source_address = "not-an-address".into();
        assert!(matches!(build_plan(&a), Err(PlanError::InvalidAddress(_, _))));
    }

    #[test]
    fn rejects_zero_amount() {
        let mut a = valid_args();
        a.amount = "0".into();
        assert!(matches!(build_plan(&a), Err(PlanError::InvalidAmount(_))));
    }

    #[test]
    fn computes_slippage_floor() {
        let a = valid_args();
        let plan = build_plan(&a).unwrap();
        let expected = 0.005 * (1.0 - 50.0 / 10_000.0);
        assert_eq!(plan.min_expected_target_amount, format!("{expected}"));
    }

    #[test]
    fn threshold_defaults_to_amount() {
        let a = valid_args();
        let plan = build_plan(&a).unwrap();
        assert_eq!(plan.threshold, plan.amount);
    }

    #[test]
    fn plan_carries_protocol_and_amount_through() {
        let a = valid_args();
        let plan = build_plan(&a).unwrap();
        assert_eq!(plan.source_protocol, "aave-v3");
        assert_eq!(plan.target_protocol, "aave-v3");
        assert_eq!(plan.amount, "0.005");
    }
}
