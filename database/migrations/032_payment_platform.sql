-- =============================================================================
-- 032  Payment platform (additive on 012 / 022–024 / 031)
--      Extends the existing central billing schema. Does NOT create a second
--      Gold/Property/Vehicle payment system.
--      - Provider-independent payment_intents
--      - Immutable payment_transactions ledger
--      - Reconciliation
--      - Bank-transfer instructions + proof (proof is never auto-success)
--      - Regional method availability (country × currency × provider × method)
--      - Richer payment statuses (3DS, refunds, chargeback)
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Status vocabulary. Existing values are preserved so live rows stay valid.
-- -----------------------------------------------------------------------------
ALTER TABLE payments
  MODIFY COLUMN status ENUM(
    'initiated',
    'pending',
    'processing',
    'requires_action',
    'requires_authentication',
    'authorized',
    'captured',
    'succeeded',
    'failed',
    'cancelled',
    'expired',
    'refunded',
    'partially_refunded',
    'disputed',
    'chargeback'
  ) NOT NULL DEFAULT 'initiated';

ALTER TABLE payments
  ADD COLUMN payment_intent_id BIGINT UNSIGNED NULL AFTER order_id,
  ADD COLUMN payment_method VARCHAR(32) NULL AFTER gateway_code,
  ADD COLUMN display_currency CHAR(3) NULL AFTER currency,
  ADD COLUMN display_amount DECIMAL(18,2) NULL AFTER display_currency,
  ADD COLUMN charge_currency CHAR(3) NULL AFTER display_amount,
  ADD COLUMN charge_amount DECIMAL(18,2) NULL AFTER charge_currency,
  ADD COLUMN settlement_currency CHAR(3) NULL AFTER charge_amount,
  ADD COLUMN settlement_amount DECIMAL(18,2) NULL AFTER settlement_currency;

ALTER TABLE refunds
  ADD COLUMN kind ENUM('full','partial') NOT NULL DEFAULT 'full' AFTER amount,
  ADD COLUMN ledger_id BIGINT UNSIGNED NULL AFTER gateway_refund_id;

-- Unique provider refund id when present (NULLs remain allowed).
ALTER TABLE refunds
  ADD UNIQUE KEY uk_refunds_gateway (gateway_refund_id);

-- Unique provider intent per gateway when present.
ALTER TABLE payments
  ADD UNIQUE KEY uk_payments_intent_ref (gateway_code, gateway_intent_id);

-- -----------------------------------------------------------------------------
-- Provider-independent PaymentIntent. payments rows are attempts against it.
-- Never stores PAN, CVV or raw credentials — only provider tokens/references.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_intents (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  order_id             BIGINT UNSIGNED NOT NULL,
  user_id              BIGINT UNSIGNED NOT NULL,
  amount               DECIMAL(18,2)   NOT NULL,
  currency             CHAR(3)         NOT NULL,
  display_currency     CHAR(3)         NULL,
  display_amount       DECIMAL(18,2)   NULL,
  charge_currency      CHAR(3)         NOT NULL,
  charge_amount        DECIMAL(18,2)   NOT NULL,
  settlement_currency  CHAR(3)         NULL,
  settlement_amount    DECIMAL(18,2)   NULL,
  exchange_rate        DECIMAL(20,10)  NULL,
  payment_method       VARCHAR(32)     NOT NULL DEFAULT 'card',
  provider             VARCHAR(32)     NOT NULL,
  provider_reference   VARCHAR(191)    NULL,
  status               ENUM(
                         'created','pending','processing','requires_action',
                         'requires_authentication','authorized','captured',
                         'succeeded','failed','cancelled','expired',
                         'refunded','partially_refunded','disputed','chargeback'
                       ) NOT NULL DEFAULT 'created',
  client_secret        VARCHAR(255)    NULL,
  redirect_url         VARCHAR(512)    NULL,
  instructions         TEXT            NULL,
  metadata             JSON            NULL,
  risk_score           TINYINT UNSIGNED NULL,
  risk_decision        ENUM('allow','challenge','review','block') NULL,
  expires_at           TIMESTAMP       NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payment_intents_uuid (uuid),
  UNIQUE KEY uk_payment_intents_provider_ref (provider, provider_reference),
  KEY idx_payment_intents_order (order_id, status),
  KEY idx_payment_intents_user (user_id, created_at),
  KEY idx_payment_intents_status (status, created_at),
  CONSTRAINT fk_payment_intents_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_intents_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_intents_provider FOREIGN KEY (provider)
    REFERENCES payment_gateways (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_intents_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_intents_charge_ccy FOREIGN KEY (charge_currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_payment_intents_amount CHECK (amount > 0 AND charge_amount > 0)
) ENGINE = InnoDB;

ALTER TABLE payments
  ADD CONSTRAINT fk_payments_intent FOREIGN KEY (payment_intent_id)
    REFERENCES payment_intents (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Immutable financial ledger. Rows are inserted, never updated or deleted.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                     CHAR(36)        NOT NULL,
  user_id                  BIGINT UNSIGNED NOT NULL,
  order_id                 BIGINT UNSIGNED NOT NULL,
  payment_id               BIGINT UNSIGNED NULL,
  payment_intent_id        BIGINT UNSIGNED NULL,
  refund_id                BIGINT UNSIGNED NULL,
  provider                 VARCHAR(32)     NOT NULL,
  provider_transaction_id  VARCHAR(191)    NULL,
  type                     ENUM('payment','refund','partial_refund','fee','adjustment','chargeback')
                             NOT NULL,
  amount                   DECIMAL(18,2)   NOT NULL,
  currency                 CHAR(3)         NOT NULL,
  status                   ENUM('pending','posted','failed','reversed') NOT NULL DEFAULT 'posted',
  metadata                 JSON            NULL,
  created_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payment_transactions_uuid (uuid),
  UNIQUE KEY uk_payment_transactions_provider (provider, provider_transaction_id),
  KEY idx_payment_transactions_user (user_id, created_at),
  KEY idx_payment_transactions_order (order_id, type),
  KEY idx_payment_transactions_payment (payment_id),
  CONSTRAINT fk_payment_tx_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_tx_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_tx_payment FOREIGN KEY (payment_id)
    REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payment_tx_intent FOREIGN KEY (payment_intent_id)
    REFERENCES payment_intents (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payment_tx_refund FOREIGN KEY (refund_id)
    REFERENCES refunds (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payment_tx_provider FOREIGN KEY (provider)
    REFERENCES payment_gateways (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_tx_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_payment_tx_amount CHECK (amount > 0)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Reconciliation between internal ledger and provider statements.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_reconciliation (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                     CHAR(36)        NOT NULL,
  provider                 VARCHAR(32)     NOT NULL,
  period_start             TIMESTAMP       NOT NULL,
  period_end               TIMESTAMP       NOT NULL,
  status                   ENUM('open','matched','mismatch','resolved') NOT NULL DEFAULT 'open',
  internal_count           INT UNSIGNED    NOT NULL DEFAULT 0,
  provider_count           INT UNSIGNED    NOT NULL DEFAULT 0,
  internal_amount          DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  provider_amount          DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  currency                 CHAR(3)         NOT NULL,
  missing_count            INT UNSIGNED    NOT NULL DEFAULT 0,
  duplicate_count          INT UNSIGNED    NOT NULL DEFAULT 0,
  amount_mismatch_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  currency_mismatch_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  webhook_failure_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  refund_mismatch_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  settlement_mismatch_count INT UNSIGNED   NOT NULL DEFAULT 0,
  notes                    VARCHAR(500)    NULL,
  created_by               BIGINT UNSIGNED NULL,
  resolved_by              BIGINT UNSIGNED NULL,
  resolved_at              TIMESTAMP       NULL,
  created_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payment_reconciliation_uuid (uuid),
  KEY idx_payment_reconciliation_provider (provider, period_start),
  KEY idx_payment_reconciliation_status (status, created_at),
  CONSTRAINT fk_payment_recon_provider FOREIGN KEY (provider)
    REFERENCES payment_gateways (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_recon_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_recon_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payment_recon_resolver FOREIGN KEY (resolved_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS payment_reconciliation_items (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reconciliation_id        BIGINT UNSIGNED NOT NULL,
  kind                     ENUM(
                             'missing_payment','duplicate_payment','wrong_amount',
                             'wrong_currency','webhook_failure','refund_mismatch',
                             'settlement_mismatch'
                           ) NOT NULL,
  payment_id               BIGINT UNSIGNED NULL,
  provider_transaction_id  VARCHAR(191)    NULL,
  expected_amount          DECIMAL(18,2)   NULL,
  actual_amount            DECIMAL(18,2)   NULL,
  currency                 CHAR(3)         NULL,
  details                  JSON            NULL,
  status                   ENUM('open','resolved','ignored') NOT NULL DEFAULT 'open',
  created_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_recon_items_recon (reconciliation_id, kind, status),
  CONSTRAINT fk_payment_recon_items_recon FOREIGN KEY (reconciliation_id)
    REFERENCES payment_reconciliation (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payment_recon_items_payment FOREIGN KEY (payment_id)
    REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Bank transfer is asynchronous. Proof upload is evidence, not settlement.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_transfer_instructions (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                CHAR(36)        NOT NULL,
  payment_intent_id   BIGINT UNSIGNED NOT NULL,
  order_id            BIGINT UNSIGNED NOT NULL,
  user_id             BIGINT UNSIGNED NOT NULL,
  reference_code      VARCHAR(48)     NOT NULL,
  bank_name           VARCHAR(128)    NOT NULL,
  account_name        VARCHAR(128)    NOT NULL,
  account_number_masked VARCHAR(32)   NOT NULL,
  iban_masked         VARCHAR(40)     NULL,
  amount              DECIMAL(18,2)   NOT NULL,
  currency            CHAR(3)         NOT NULL,
  status              ENUM('pending','confirmed','expired','cancelled') NOT NULL DEFAULT 'pending',
  expires_at          TIMESTAMP       NULL,
  confirmed_at        TIMESTAMP       NULL,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bank_transfer_uuid (uuid),
  UNIQUE KEY uk_bank_transfer_reference (reference_code),
  KEY idx_bank_transfer_order (order_id),
  KEY idx_bank_transfer_intent (payment_intent_id),
  CONSTRAINT fk_bank_transfer_intent FOREIGN KEY (payment_intent_id)
    REFERENCES payment_intents (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_bank_transfer_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_bank_transfer_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_bank_transfer_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS bank_transfer_proofs (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)        NOT NULL,
  instruction_id    BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  storage_path      VARCHAR(512)    NOT NULL,
  mime_type         VARCHAR(128)    NOT NULL,
  status            ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by       BIGINT UNSIGNED NULL,
  reviewed_at       TIMESTAMP       NULL,
  notes             VARCHAR(500)    NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bank_transfer_proofs_uuid (uuid),
  KEY idx_bank_transfer_proofs_instruction (instruction_id, status),
  CONSTRAINT fk_bank_proof_instruction FOREIGN KEY (instruction_id)
    REFERENCES bank_transfer_instructions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bank_proof_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_bank_proof_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Regional wallets / methods. Country + currency decide what is offered.
-- payment_method is the method; provider_code is the adapter.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regional_payment_methods (
  id             INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  country_id     SMALLINT UNSIGNED NOT NULL,
  currency       CHAR(3)           NOT NULL,
  provider_code  VARCHAR(32)       NOT NULL,
  payment_method VARCHAR(32)       NOT NULL,
  is_enabled     BOOLEAN           NOT NULL DEFAULT TRUE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_regional_payment_methods (country_id, currency, provider_code, payment_method),
  KEY idx_regional_payment_methods_live (is_enabled, country_id, currency),
  CONSTRAINT fk_regional_pm_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_regional_pm_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_regional_pm_provider FOREIGN KEY (provider_code)
    REFERENCES payment_gateways (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Client retry / refund idempotency. Unique per user + operation + key.
CREATE TABLE IF NOT EXISTS payment_idempotency_keys (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NOT NULL,
  operation        VARCHAR(32)     NOT NULL,
  idempotency_key  VARCHAR(128)    NOT NULL,
  request_hash     CHAR(64)        NOT NULL,
  response_json    JSON            NULL,
  status           ENUM('processing','completed','failed') NOT NULL DEFAULT 'processing',
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payment_idempotency (user_id, operation, idempotency_key),
  KEY idx_payment_idempotency_created (created_at),
  CONSTRAINT fk_payment_idempotency_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
