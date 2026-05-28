---
name: smart-contract-review
version: 0.1.0
description: Solidity and onchain integration review rules for token, wallet, and contract work.
priority: 92
budget-multiplier: 1.2
allow-fallback: true
---

# smart-contract-review Skill

## Purpose
Use this skill when a task touches Solidity, token contracts, deployment scripts, ABIs, viem/ethers calls, wallet auth, signatures, or onchain reads.

## Read First
- contracts/
- deploy scripts
- ABI files
- wallet and signature verification code
- chain configuration
- tests for token balances, auth, and quotas

## Rules
- Treat private keys, mnemonics, RPC secrets, and deploy wallets as blocked secret material.
- Check chain id, token decimals, address validation, nonce scope, and signature domain.
- Do not assume contract source or token metadata is verified unless a source says so.
- Separate read-only chain calls from transactions and approvals.
- Avoid adding transaction flows without explicit user approval and clear risk notes.

## Verification
- Prefer read-only simulations and local tests before live network assumptions.
- Check decimal parsing/formatting around holder thresholds.
- Validate error behavior for missing RPC, invalid address, and zero balance.
- State which chain and contract address were assumed.
