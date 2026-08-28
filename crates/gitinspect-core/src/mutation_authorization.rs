//! Design-only authorization, replay and effect-boundary qualification for a
//! possible future original-repository mutation path.
//!
//! This module deliberately does not accept [`crate::RepositoryHandle`], does
//! not execute Git, and exposes no apply operation. It qualifies a backend-owned
//! single-use capability ledger and restart semantics independently from any
//! production mutation authority. All currently previewable operation classes
//! remain fail-closed for original-repository execution.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::{MutationPreflightAssessment, MutationPreflightReceipt, MutationPreviewOperation};

const AUTHORIZATION_SCHEMA_VERSION: u8 = 1;
const CAPABILITY_SECRET_BYTES: usize = 32;
const MAX_EFFECT_STEPS: usize = 64;

/// Backend-owned entropy seam. A future production backend must supply a
/// cryptographically secure implementation. There is intentionally no default
/// or renderer-facing implementation in Phase 29.
pub trait MutationCapabilitySecretSource {
    fn fill_secret(
        &mut self,
        destination: &mut [u8; CAPABILITY_SECRET_BYTES],
    ) -> Result<(), String>;
}

/// In-memory capability material returned only to the backend caller that
/// issued it. The raw secret is never serializable and never appears in durable
/// ledger snapshots.
pub struct MutationAuthorizationCapability {
    authorization_id: String,
    secret: [u8; CAPABILITY_SECRET_BYTES],
}

impl fmt::Debug for MutationAuthorizationCapability {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("MutationAuthorizationCapability")
            .field("authorization_id", &self.authorization_id)
            .field("secret", &"<redacted>")
            .finish()
    }
}

impl MutationAuthorizationCapability {
    pub fn authorization_id(&self) -> &str {
        &self.authorization_id
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationAuthorizationBinding {
    pub repository_identity_digest: String,
    pub source_state_digest: String,
    pub receipt_digest: String,
    pub transaction_id: String,
    pub operation_digest: String,
    pub preview_result_digest: String,
}

impl MutationAuthorizationBinding {
    pub fn from_receipt(receipt: &MutationPreflightReceipt) -> Self {
        Self {
            repository_identity_digest: repository_identity_digest(receipt),
            source_state_digest: receipt.source.state_digest.clone(),
            receipt_digest: receipt.receipt_digest.clone(),
            transaction_id: receipt.preview.transaction_id.clone(),
            operation_digest: receipt.preview.operation_digest.clone(),
            preview_result_digest: receipt.preview.preview_result_digest.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MutationAuthorizationState {
    Issued,
    Consumed,
    ExpiredOnRestart,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationAuthorizationRecord {
    pub authorization_id: String,
    pub binding: MutationAuthorizationBinding,
    pub secret_digest: String,
    pub state: MutationAuthorizationState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MutationAttemptState {
    ReservedBeforeEffect,
    RejectedBeforeEffect,
    EffectStarted,
    Succeeded,
    FailedNoEffect,
    AbandonedBeforeEffect,
    RecoveryRequired,
}

impl MutationAttemptState {
    pub fn terminal(self) -> bool {
        matches!(
            self,
            Self::RejectedBeforeEffect
                | Self::Succeeded
                | Self::FailedNoEffect
                | Self::AbandonedBeforeEffect
                | Self::RecoveryRequired
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationAttemptRecord {
    pub attempt_id: String,
    pub authorization_id: String,
    pub binding: MutationAuthorizationBinding,
    pub state: MutationAttemptState,
    pub completed_effect_steps: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

impl MutationAttemptRecord {
    /// Consumed attempts are never automatically retryable, including attempts
    /// proven to have stopped before their first effect.
    pub fn automatically_retryable(&self) -> bool {
        false
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationAuthorizationLedgerSnapshot {
    pub schema_version: u8,
    pub authorizations: Vec<MutationAuthorizationRecord>,
    pub attempts: Vec<MutationAttemptRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationFinalPreflightVerdict {
    pub fresh: bool,
    pub failure_messages: Vec<String>,
}

impl MutationFinalPreflightVerdict {
    pub fn from_assessment(assessment: &MutationPreflightAssessment) -> Self {
        Self {
            fresh: assessment.fresh,
            failure_messages: assessment
                .failures
                .iter()
                .map(|failure| failure.message.clone())
                .collect(),
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MutationAuthorizationError {
    #[error("capability secret source failed: {0}")]
    SecretSource(String),
    #[error("authorization capability is unknown or has an invalid secret")]
    InvalidCapability,
    #[error("authorization capability has already been consumed or expired")]
    CapabilityUnavailable,
    #[error("authorization binding does not match the exact receipt/source/preview identity")]
    BindingMismatch,
    #[error("authorization ledger lock is poisoned")]
    LockPoisoned,
    #[error("authorization ledger snapshot is invalid: {0}")]
    InvalidSnapshot(String),
    #[error("final preflight rejected the attempt before any effect: {0}")]
    FinalPreflightRejected(String),
    #[error("unknown mutation attempt: {0}")]
    UnknownAttempt(String),
    #[error("attempt {attempt_id} cannot transition from {state:?} to {requested}")]
    InvalidAttemptTransition {
        attempt_id: String,
        state: MutationAttemptState,
        requested: &'static str,
    },
    #[error("attempt {0} exceeded the bounded effect-step evidence limit")]
    EffectStepLimit(String),
}

#[derive(Debug, Default)]
struct MutationAuthorizationLedgerState {
    authorizations: BTreeMap<String, MutationAuthorizationRecord>,
    attempts: BTreeMap<String, MutationAttemptRecord>,
}

/// Backend-owned single-use ledger model. The mutex serializes authorization
/// validation/consumption with the supplied final-preflight callback. It cannot
/// lock out external Git processes, so this model does not claim to close the
/// final repository TOCTOU boundary.
#[derive(Debug, Default)]
pub struct MutationAuthorizationLedger {
    state: Mutex<MutationAuthorizationLedgerState>,
}

impl MutationAuthorizationLedger {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn issue<S: MutationCapabilitySecretSource>(
        &self,
        receipt: &MutationPreflightReceipt,
        source: &mut S,
    ) -> Result<MutationAuthorizationCapability, MutationAuthorizationError> {
        let mut secret = [0_u8; CAPABILITY_SECRET_BYTES];
        source
            .fill_secret(&mut secret)
            .map_err(MutationAuthorizationError::SecretSource)?;
        let secret_digest = capability_secret_digest(&secret);
        let authorization_id = authorization_id(&secret_digest, &receipt.receipt_digest);
        let binding = MutationAuthorizationBinding::from_receipt(receipt);
        let mut state = self
            .state
            .lock()
            .map_err(|_| MutationAuthorizationError::LockPoisoned)?;
        if state.authorizations.contains_key(&authorization_id) {
            return Err(MutationAuthorizationError::InvalidSnapshot(
                "capability source produced a duplicate authorization identity".to_owned(),
            ));
        }
        state.authorizations.insert(
            authorization_id.clone(),
            MutationAuthorizationRecord {
                authorization_id: authorization_id.clone(),
                binding,
                secret_digest,
                state: MutationAuthorizationState::Issued,
            },
        );
        Ok(MutationAuthorizationCapability {
            authorization_id,
            secret,
        })
    }

    /// Atomically validates and consumes the backend capability and runs the
    /// final-preflight callback while the ledger critical section is held.
    ///
    /// A correct capability is burned even if final preflight fails. This makes
    /// stale/failed attempts non-replayable. The returned attempt remains
    /// `ReservedBeforeEffect`; a separate explicit transition must be durably
    /// recorded before any fixture effect is simulated.
    pub fn begin_attempt<F>(
        &self,
        capability: &MutationAuthorizationCapability,
        expected_binding: &MutationAuthorizationBinding,
        final_preflight: F,
    ) -> Result<String, MutationAuthorizationError>
    where
        F: FnOnce() -> Result<MutationFinalPreflightVerdict, String>,
    {
        let mut state = self
            .state
            .lock()
            .map_err(|_| MutationAuthorizationError::LockPoisoned)?;
        let record = state
            .authorizations
            .get_mut(capability.authorization_id())
            .ok_or(MutationAuthorizationError::InvalidCapability)?;
        if record.secret_digest != capability_secret_digest(&capability.secret) {
            return Err(MutationAuthorizationError::InvalidCapability);
        }
        if record.state != MutationAuthorizationState::Issued {
            return Err(MutationAuthorizationError::CapabilityUnavailable);
        }
        if &record.binding != expected_binding {
            record.state = MutationAuthorizationState::Consumed;
            let attempt_id = attempt_id(&record.authorization_id);
            let attempt = MutationAttemptRecord {
                attempt_id: attempt_id.clone(),
                authorization_id: record.authorization_id.clone(),
                binding: record.binding.clone(),
                state: MutationAttemptState::RejectedBeforeEffect,
                completed_effect_steps: Vec::new(),
                failure_reason: Some(
                    "authorization binding did not match the exact receipt/source/preview identity"
                        .to_owned(),
                ),
            };
            state.attempts.insert(attempt_id, attempt);
            return Err(MutationAuthorizationError::BindingMismatch);
        }

        record.state = MutationAuthorizationState::Consumed;
        let attempt_id = attempt_id(&record.authorization_id);
        let attempt = MutationAttemptRecord {
            attempt_id: attempt_id.clone(),
            authorization_id: record.authorization_id.clone(),
            binding: record.binding.clone(),
            state: MutationAttemptState::ReservedBeforeEffect,
            completed_effect_steps: Vec::new(),
            failure_reason: None,
        };
        state.attempts.insert(attempt_id.clone(), attempt);

        let verdict = match final_preflight() {
            Ok(verdict) => verdict,
            Err(reason) => {
                let attempt = state
                    .attempts
                    .get_mut(&attempt_id)
                    .expect("attempt inserted");
                attempt.state = MutationAttemptState::RejectedBeforeEffect;
                attempt.failure_reason = Some(reason.clone());
                return Err(MutationAuthorizationError::FinalPreflightRejected(reason));
            }
        };
        if !verdict.fresh {
            let reason = if verdict.failure_messages.is_empty() {
                "freshness assessment failed without detail".to_owned()
            } else {
                verdict.failure_messages.join("; ")
            };
            let attempt = state
                .attempts
                .get_mut(&attempt_id)
                .expect("attempt inserted");
            attempt.state = MutationAttemptState::RejectedBeforeEffect;
            attempt.failure_reason = Some(reason.clone());
            return Err(MutationAuthorizationError::FinalPreflightRejected(reason));
        }
        Ok(attempt_id)
    }

    /// Must be persisted before a real executor could cross its first effect
    /// boundary. A restart from this state is always `RecoveryRequired` because
    /// the durable record cannot prove whether the first effect happened.
    pub fn mark_effect_started(&self, attempt_id: &str) -> Result<(), MutationAuthorizationError> {
        self.transition(attempt_id, "effect-started", |attempt| {
            if attempt.state != MutationAttemptState::ReservedBeforeEffect {
                return false;
            }
            attempt.state = MutationAttemptState::EffectStarted;
            true
        })
    }

    pub fn record_effect_step(
        &self,
        attempt_id: &str,
        step: impl Into<String>,
    ) -> Result<(), MutationAuthorizationError> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| MutationAuthorizationError::LockPoisoned)?;
        let attempt = state
            .attempts
            .get_mut(attempt_id)
            .ok_or_else(|| MutationAuthorizationError::UnknownAttempt(attempt_id.to_owned()))?;
        if attempt.state != MutationAttemptState::EffectStarted {
            return Err(MutationAuthorizationError::InvalidAttemptTransition {
                attempt_id: attempt_id.to_owned(),
                state: attempt.state,
                requested: "record-effect-step",
            });
        }
        if attempt.completed_effect_steps.len() >= MAX_EFFECT_STEPS {
            return Err(MutationAuthorizationError::EffectStepLimit(
                attempt_id.to_owned(),
            ));
        }
        attempt.completed_effect_steps.push(step.into());
        Ok(())
    }

    pub fn complete_success(&self, attempt_id: &str) -> Result<(), MutationAuthorizationError> {
        self.transition(attempt_id, "succeeded", |attempt| {
            if attempt.state != MutationAttemptState::EffectStarted {
                return false;
            }
            attempt.state = MutationAttemptState::Succeeded;
            true
        })
    }

    pub fn fail_before_effect(
        &self,
        attempt_id: &str,
        reason: impl Into<String>,
    ) -> Result<(), MutationAuthorizationError> {
        let reason = reason.into();
        self.transition(attempt_id, "failed-no-effect", move |attempt| {
            if attempt.state != MutationAttemptState::ReservedBeforeEffect {
                return false;
            }
            attempt.state = MutationAttemptState::FailedNoEffect;
            attempt.failure_reason = Some(reason);
            true
        })
    }

    pub fn mark_uncertain(
        &self,
        attempt_id: &str,
        reason: impl Into<String>,
    ) -> Result<(), MutationAuthorizationError> {
        let reason = reason.into();
        self.transition(attempt_id, "recovery-required", move |attempt| {
            if attempt.state != MutationAttemptState::EffectStarted {
                return false;
            }
            attempt.state = MutationAttemptState::RecoveryRequired;
            attempt.failure_reason = Some(reason);
            true
        })
    }

    pub fn attempt(
        &self,
        attempt_id: &str,
    ) -> Result<MutationAttemptRecord, MutationAuthorizationError> {
        self.state
            .lock()
            .map_err(|_| MutationAuthorizationError::LockPoisoned)?
            .attempts
            .get(attempt_id)
            .cloned()
            .ok_or_else(|| MutationAuthorizationError::UnknownAttempt(attempt_id.to_owned()))
    }

    pub fn snapshot(
        &self,
    ) -> Result<MutationAuthorizationLedgerSnapshot, MutationAuthorizationError> {
        let state = self
            .state
            .lock()
            .map_err(|_| MutationAuthorizationError::LockPoisoned)?;
        Ok(MutationAuthorizationLedgerSnapshot {
            schema_version: AUTHORIZATION_SCHEMA_VERSION,
            authorizations: state.authorizations.values().cloned().collect(),
            attempts: state.attempts.values().cloned().collect(),
        })
    }

    /// Restore a durable snapshot conservatively. Outstanding capabilities are
    /// invalidated on restart. An attempt recorded before its effect marker is
    /// abandoned without retry; an attempt with an effect marker is uncertain
    /// and requires explicit recovery/reinspection.
    pub fn recover(
        snapshot: MutationAuthorizationLedgerSnapshot,
    ) -> Result<Self, MutationAuthorizationError> {
        if snapshot.schema_version != AUTHORIZATION_SCHEMA_VERSION {
            return Err(MutationAuthorizationError::InvalidSnapshot(format!(
                "unsupported schema version {}",
                snapshot.schema_version
            )));
        }
        let mut state = MutationAuthorizationLedgerState::default();
        for mut authorization in snapshot.authorizations {
            if authorization.state == MutationAuthorizationState::Issued {
                authorization.state = MutationAuthorizationState::ExpiredOnRestart;
            }
            if state
                .authorizations
                .insert(authorization.authorization_id.clone(), authorization)
                .is_some()
            {
                return Err(MutationAuthorizationError::InvalidSnapshot(
                    "duplicate authorization id".to_owned(),
                ));
            }
        }
        for mut attempt in snapshot.attempts {
            match attempt.state {
                MutationAttemptState::ReservedBeforeEffect => {
                    attempt.state = MutationAttemptState::AbandonedBeforeEffect;
                    attempt.failure_reason = Some(
                        "backend restarted after authorization consumption but before effect start; attempt is not replayed"
                            .to_owned(),
                    );
                }
                MutationAttemptState::EffectStarted => {
                    attempt.state = MutationAttemptState::RecoveryRequired;
                    attempt.failure_reason = Some(
                        "backend restarted after the durable effect-start marker; partial effect cannot be excluded"
                            .to_owned(),
                    );
                }
                _ => {}
            }
            if state
                .attempts
                .insert(attempt.attempt_id.clone(), attempt)
                .is_some()
            {
                return Err(MutationAuthorizationError::InvalidSnapshot(
                    "duplicate attempt id".to_owned(),
                ));
            }
        }
        Ok(Self {
            state: Mutex::new(state),
        })
    }

    fn transition<F>(
        &self,
        attempt_id: &str,
        requested: &'static str,
        transition: F,
    ) -> Result<(), MutationAuthorizationError>
    where
        F: FnOnce(&mut MutationAttemptRecord) -> bool,
    {
        let mut state = self
            .state
            .lock()
            .map_err(|_| MutationAuthorizationError::LockPoisoned)?;
        let attempt = state
            .attempts
            .get_mut(attempt_id)
            .ok_or_else(|| MutationAuthorizationError::UnknownAttempt(attempt_id.to_owned()))?;
        let previous = attempt.state;
        if !transition(attempt) {
            return Err(MutationAuthorizationError::InvalidAttemptTransition {
                attempt_id: attempt_id.to_owned(),
                state: previous,
                requested,
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MutationEffectClass {
    SingleRefUpdate,
    BranchRenameWithConfigAndReflog,
    RewriteWithObjectIndexWorktreeEffects,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MutationQualificationBlocker {
    FinalRepositoryToctou,
    DurableAtomicLedgerStoreNotWiredToOriginalAuthority,
    OriginalRefTransactionExecutorNotQualified,
    MultiRefConfigReflogAtomicityNotClosed,
    IndexWorktreeCrashRecoveryNotClosed,
    ExternalProgramIsolationNotClosed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MutationOriginalApplyDisposition {
    FailClosed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationOperationQualification {
    pub operation_kind: String,
    pub effect_class: MutationEffectClass,
    pub fixture_model: String,
    pub blockers: Vec<MutationQualificationBlocker>,
    pub original_apply: MutationOriginalApplyDisposition,
}

/// Per-operation Phase-29 decision. A subset of ref operations has a simple
/// single-ref atomic *model*, but no original executor or final lock proof is
/// implemented; every operation therefore remains fail-closed.
pub fn qualify_mutation_operation(
    operation: &MutationPreviewOperation,
) -> MutationOperationQualification {
    let (effect_class, fixture_model, blockers) = match operation {
        MutationPreviewOperation::BranchCreate { .. }
        | MutationPreviewOperation::BranchDelete { .. }
        | MutationPreviewOperation::TagCreate { .. }
        | MutationPreviewOperation::TagDelete { .. }
        | MutationPreviewOperation::TagMove { .. } => (
            MutationEffectClass::SingleRefUpdate,
            "single expected-old/new ref transition; fixture model is atomic as one state write",
            vec![
                MutationQualificationBlocker::FinalRepositoryToctou,
                MutationQualificationBlocker::DurableAtomicLedgerStoreNotWiredToOriginalAuthority,
                MutationQualificationBlocker::OriginalRefTransactionExecutorNotQualified,
            ],
        ),
        MutationPreviewOperation::BranchRename { .. } => (
            MutationEffectClass::BranchRenameWithConfigAndReflog,
            "rename spans old/new ref identity and may also affect branch config/reflog/HEAD semantics",
            vec![
                MutationQualificationBlocker::FinalRepositoryToctou,
                MutationQualificationBlocker::DurableAtomicLedgerStoreNotWiredToOriginalAuthority,
                MutationQualificationBlocker::OriginalRefTransactionExecutorNotQualified,
                MutationQualificationBlocker::MultiRefConfigReflogAtomicityNotClosed,
            ],
        ),
        MutationPreviewOperation::CherryPick { .. }
        | MutationPreviewOperation::RebaseReorder { .. }
        | MutationPreviewOperation::Squash { .. }
        | MutationPreviewOperation::Fixup { .. }
        | MutationPreviewOperation::Reword { .. }
        | MutationPreviewOperation::Drop { .. }
        | MutationPreviewOperation::Split { .. } => (
            MutationEffectClass::RewriteWithObjectIndexWorktreeEffects,
            "rewrite may create objects and change refs/index/worktree across multiple crash points",
            vec![
                MutationQualificationBlocker::FinalRepositoryToctou,
                MutationQualificationBlocker::DurableAtomicLedgerStoreNotWiredToOriginalAuthority,
                MutationQualificationBlocker::IndexWorktreeCrashRecoveryNotClosed,
                MutationQualificationBlocker::ExternalProgramIsolationNotClosed,
            ],
        ),
    };
    MutationOperationQualification {
        operation_kind: operation.kind_name().to_owned(),
        effect_class,
        fixture_model: fixture_model.to_owned(),
        blockers,
        original_apply: MutationOriginalApplyDisposition::FailClosed,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationExecutionIsolationInputs {
    pub uses_git_subprocess: bool,
    pub inherited_process_environment: bool,
    pub effective_config_fully_bound: bool,
    pub active_repository_hooks: bool,
    pub custom_hooks_path: bool,
    pub config_includes: bool,
    pub repository_filters_or_merge_drivers_may_execute: bool,
    pub signing_program_may_execute: bool,
    pub editor_may_execute: bool,
    pub credential_or_transport_helper_may_execute: bool,
    pub network_access_possible: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MutationExecutionIsolationFailure {
    GitSubprocessEnvironmentNotFullyOwned,
    EffectiveConfigNotFullyBound,
    ActiveRepositoryHooks,
    CustomHooksPath,
    ConfigIncludes,
    RepositoryFilterOrMergeDriver,
    SigningProgram,
    Editor,
    CredentialOrTransportHelper,
    NetworkAccess,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationExecutionIsolationAssessment {
    pub isolated: bool,
    pub failures: Vec<MutationExecutionIsolationFailure>,
}

/// Conservative external-execution policy. The current copy-preview subprocess
/// hardening (empty hooks, no global/system config, signing disabled) is useful,
/// but a future original rewrite must additionally prove that inherited process
/// environment, effective config, attributes/filters/merge drivers, editors,
/// helpers and network cannot launch repository-controlled programs.
pub fn assess_mutation_execution_isolation(
    inputs: &MutationExecutionIsolationInputs,
) -> MutationExecutionIsolationAssessment {
    let mut failures = Vec::new();
    if inputs.uses_git_subprocess && inputs.inherited_process_environment {
        failures.push(MutationExecutionIsolationFailure::GitSubprocessEnvironmentNotFullyOwned);
    }
    if inputs.uses_git_subprocess && !inputs.effective_config_fully_bound {
        failures.push(MutationExecutionIsolationFailure::EffectiveConfigNotFullyBound);
    }
    if inputs.active_repository_hooks {
        failures.push(MutationExecutionIsolationFailure::ActiveRepositoryHooks);
    }
    if inputs.custom_hooks_path {
        failures.push(MutationExecutionIsolationFailure::CustomHooksPath);
    }
    if inputs.config_includes {
        failures.push(MutationExecutionIsolationFailure::ConfigIncludes);
    }
    if inputs.repository_filters_or_merge_drivers_may_execute {
        failures.push(MutationExecutionIsolationFailure::RepositoryFilterOrMergeDriver);
    }
    if inputs.signing_program_may_execute {
        failures.push(MutationExecutionIsolationFailure::SigningProgram);
    }
    if inputs.editor_may_execute {
        failures.push(MutationExecutionIsolationFailure::Editor);
    }
    if inputs.credential_or_transport_helper_may_execute {
        failures.push(MutationExecutionIsolationFailure::CredentialOrTransportHelper);
    }
    if inputs.network_access_possible {
        failures.push(MutationExecutionIsolationFailure::NetworkAccess);
    }
    MutationExecutionIsolationAssessment {
        isolated: failures.is_empty(),
        failures,
    }
}

fn capability_secret_digest(secret: &[u8; CAPABILITY_SECRET_BYTES]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-capability-secret-v1\0");
    hasher.update(secret);
    format!("sha256:{:x}", hasher.finalize())
}

fn authorization_id(secret_digest: &str, receipt_digest: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-authorization-id-v1\0");
    hash_string(&mut hasher, secret_digest);
    hash_string(&mut hasher, receipt_digest);
    format!("authorization-sha256:{:x}", hasher.finalize())
}

fn attempt_id(authorization_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-attempt-id-v1\0");
    hash_string(&mut hasher, authorization_id);
    format!("attempt-sha256:{:x}", hasher.finalize())
}

fn repository_identity_digest(receipt: &MutationPreflightReceipt) -> String {
    let identity = &receipt.source.repository_identity;
    let mut hasher = Sha256::new();
    hasher.update(b"gitinspect-mutation-repository-identity-v1\0");
    for path in [
        &identity.repository,
        &identity.git_dir,
        &identity.common_dir,
    ] {
        hash_string(&mut hasher, &path.canonical_path);
        hash_optional_u64(&mut hasher, path.device);
        hash_optional_u64(&mut hasher, path.inode);
        match path.owner_uid {
            Some(value) => {
                hasher.update([1]);
                hasher.update(value.to_le_bytes());
            }
            None => hasher.update([0]),
        }
    }
    hasher.update([identity.bare as u8]);
    format!("sha256:{:x}", hasher.finalize())
}

fn hash_string(hasher: &mut Sha256, value: &str) {
    hasher.update(value.len().to_le_bytes());
    hasher.update(value.as_bytes());
}

fn hash_optional_u64(hasher: &mut Sha256, value: Option<u64>) {
    match value {
        Some(value) => {
            hasher.update([1]);
            hasher.update(value.to_le_bytes());
        }
        None => hasher.update([0]),
    }
}
