// Reference: governance/GD-M39-1.md — Decision 8 (Deterministic Per-Tenant Hash Chaining),
// Decision 24 validation-gate item: "Canonical hash proven deterministic
// across write and verification paths, across every specified field type
// (BigInt-as-string, nested metadata, null positions)"

import {
  HASH_VERSION_V1,
  canonicalizeAuditEventV1,
  canonicalizeAuditEvent,
  computeAuditEventHash,
  hashAuditEvent,
  sortMetadataKeysDeep,
  UnknownAuditHashVersionError,
  AUDIT_HASH_CANONICALIZERS,
  type AuditHashFields,
} from './audit-hash.util';

function baseFields(overrides: Partial<AuditHashFields> = {}): AuditHashFields {
  return {
    hashVersion: HASH_VERSION_V1,
    tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    sequenceNo: 1n,
    eventId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    userId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    action: 'AUTH_LOGIN_SUCCESS',
    entityType: null,
    entityId: null,
    result: 'SUCCESS',
    metadata: null,
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.100Z'),
    retentionUntil: new Date('2033-01-01T00:00:00.000Z'),
    previousHash: null,
    ...overrides,
  };
}

describe('sortMetadataKeysDeep', () => {
  it('sorts object keys in ascending order at the top level', () => {
    const result = sortMetadataKeysDeep({ b: 1, a: 2, c: 3 });
    expect(Object.keys(result as object)).toEqual(['a', 'b', 'c']);
  });

  it('sorts keys recursively at every nesting depth', () => {
    const result = sortMetadataKeysDeep({ z: { y: 1, x: 2 }, a: 1 }) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['a', 'z']);
    expect(Object.keys(result.z as object)).toEqual(['x', 'y']);
  });

  it('preserves array element order without sorting', () => {
    const result = sortMetadataKeysDeep({ list: [3, 1, 2] }) as Record<string, unknown>;
    expect(result.list).toEqual([3, 1, 2]);
  });

  it('sorts objects nested inside arrays without reordering the array', () => {
    const result = sortMetadataKeysDeep({ list: [{ b: 1, a: 2 }] }) as Record<string, unknown>;
    const list = result.list as Array<Record<string, unknown>>;
    expect(Object.keys(list[0]!)).toEqual(['a', 'b']);
  });

  it('omits properties whose value is undefined', () => {
    const result = sortMetadataKeysDeep({ a: 1, b: undefined }) as Record<string, unknown>;
    expect('b' in result).toBe(false);
    expect(result.a).toBe(1);
  });

  it('preserves an explicit null value', () => {
    const result = sortMetadataKeysDeep({ a: null }) as Record<string, unknown>;
    expect(result.a).toBeNull();
  });

  it('passes primitives through unchanged', () => {
    expect(sortMetadataKeysDeep('x')).toBe('x');
    expect(sortMetadataKeysDeep(42)).toBe(42);
    expect(sortMetadataKeysDeep(null)).toBeNull();
  });
});

describe('canonicalizeAuditEventV1', () => {
  it('produces a fixed-position 14-element JSON array', () => {
    const json = canonicalizeAuditEventV1(baseFields());
    const parsed = JSON.parse(json) as unknown[];
    expect(parsed).toHaveLength(14);
  });

  it('places fields in the exact governed order', () => {
    const fields = baseFields({
      entityType: 'EMPLOYEE',
      entityId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      previousHash: 'a'.repeat(64),
    });
    const parsed = JSON.parse(canonicalizeAuditEventV1(fields)) as unknown[];
    expect(parsed).toEqual([
      HASH_VERSION_V1,
      fields.tenantId,
      '1',
      fields.eventId,
      fields.userId,
      fields.action,
      'EMPLOYEE',
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'SUCCESS',
      null,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.100Z',
      '2033-01-01T00:00:00.000Z',
      'a'.repeat(64),
    ]);
  });

  it('represents sequenceNo as an exact decimal string, never a JS number', () => {
    const parsed = JSON.parse(
      canonicalizeAuditEventV1(baseFields({ sequenceNo: 9007199254740993n })),
    ) as unknown[];
    // 9007199254740993 exceeds Number.MAX_SAFE_INTEGER — a lossy coercion
    // would silently round it. The exact string must survive.
    expect(parsed[2]).toBe('9007199254740993');
  });

  it('represents null entityType/entityId/previousHash as JSON null at their fixed position', () => {
    const parsed = JSON.parse(canonicalizeAuditEventV1(baseFields())) as unknown[];
    expect(parsed[6]).toBeNull();
    expect(parsed[7]).toBeNull();
    expect(parsed[13]).toBeNull();
  });

  it('canonicalizes metadata with recursively sorted keys', () => {
    const parsed = JSON.parse(
      canonicalizeAuditEventV1(baseFields({ metadata: { z: 1, a: { y: 1, x: 2 } } })),
    ) as unknown[];
    expect(parsed[9]).toEqual({ a: { x: 2, y: 1 }, z: 1 });
  });

  it('treats undefined metadata identically to null metadata', () => {
    const withNull = canonicalizeAuditEventV1(baseFields({ metadata: null }));
    const withUndefined = canonicalizeAuditEventV1(baseFields({ metadata: undefined }));
    expect(withNull).toBe(withUndefined);
  });

  it('produces byte-identical output for byte-identical input (determinism)', () => {
    const fields = baseFields({ metadata: { a: 1, nested: { c: 3, b: 2 } } });
    expect(canonicalizeAuditEventV1(fields)).toBe(canonicalizeAuditEventV1(fields));
  });

  it('produces different output when any single field changes', () => {
    const a = canonicalizeAuditEventV1(baseFields());
    const b = canonicalizeAuditEventV1(baseFields({ result: 'FAILURE' }));
    expect(a).not.toBe(b);
  });

  it('correctly UTF-8-encodes Unicode metadata (non-Latin scripts, emoji, combining marks)', () => {
    const fields = baseFields({
      metadata: { note: '你好世界 🚀 café مرحبا' },
    });
    const json = canonicalizeAuditEventV1(fields);
    const parsed = JSON.parse(json) as unknown[];
    // Round-trips exactly — proves no mangling/mojibake through the
    // canonicalization step, independent of what SHA-256 does with the bytes.
    expect((parsed[9] as { note: string }).note).toBe(
      '你好世界 🚀 café مرحبا',
    );
    // Hashing Unicode content must not throw and must still be deterministic.
    expect(() => hashAuditEvent(fields)).not.toThrow();
    expect(hashAuditEvent(fields)).toBe(hashAuditEvent(fields));
  });

  it('handles empty-string field values distinctly from null/undefined', () => {
    const emptyEntityType = canonicalizeAuditEventV1(baseFields({ entityType: '' }));
    const nullEntityType = canonicalizeAuditEventV1(baseFields({ entityType: null }));
    expect(emptyEntityType).not.toBe(nullEntityType);
    expect((JSON.parse(emptyEntityType) as unknown[])[6]).toBe('');
  });

  it('handles an empty metadata object distinctly from null metadata', () => {
    const emptyObject = canonicalizeAuditEventV1(baseFields({ metadata: {} }));
    const nullMetadata = canonicalizeAuditEventV1(baseFields({ metadata: null }));
    expect(emptyObject).not.toBe(nullMetadata);
    expect((JSON.parse(emptyObject) as unknown[])[9]).toEqual({});
  });

  it('handles an empty array within metadata, preserving it as an empty array (not stripped)', () => {
    const json = canonicalizeAuditEventV1(baseFields({ metadata: { tags: [] } }));
    expect((JSON.parse(json) as unknown[])[9]).toEqual({ tags: [] });
  });
});

describe('canonicalizeAuditEvent — version dispatch', () => {
  it('dispatches to the v1 canonicalizer for hashVersion "v1"', () => {
    const fields = baseFields();
    expect(canonicalizeAuditEvent(fields)).toBe(canonicalizeAuditEventV1(fields));
  });

  it('throws UnknownAuditHashVersionError for an unrecognized hashVersion', () => {
    const fields = baseFields({ hashVersion: 'v99' });
    expect(() => canonicalizeAuditEvent(fields)).toThrow(UnknownAuditHashVersionError);
  });

  it('AUDIT_HASH_CANONICALIZERS exposes exactly the v1 entry today', () => {
    expect(Object.keys(AUDIT_HASH_CANONICALIZERS)).toEqual([HASH_VERSION_V1]);
  });
});

describe('computeAuditEventHash / hashAuditEvent', () => {
  it('produces a 64-character lowercase hexadecimal string', () => {
    const hash = hashAuditEvent(baseFields());
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — identical fields hash identically', () => {
    expect(hashAuditEvent(baseFields())).toBe(hashAuditEvent(baseFields()));
  });

  it('changes when previousHash changes (chain linkage)', () => {
    const a = hashAuditEvent(baseFields({ previousHash: null }));
    const b = hashAuditEvent(baseFields({ previousHash: 'f'.repeat(64) }));
    expect(a).not.toBe(b);
  });

  it('changes when sequenceNo changes', () => {
    const a = hashAuditEvent(baseFields({ sequenceNo: 1n }));
    const b = hashAuditEvent(baseFields({ sequenceNo: 2n }));
    expect(a).not.toBe(b);
  });

  it('computeAuditEventHash(canonicalizeAuditEventV1(fields)) equals hashAuditEvent(fields)', () => {
    const fields = baseFields({ metadata: { updatedFields: ['a', 'b'] } });
    expect(computeAuditEventHash(canonicalizeAuditEventV1(fields))).toBe(hashAuditEvent(fields));
  });
});
