import { isJsonFieldAbsentFromResults } from '../../../src/engine/goals/jsonFieldCriterion';

// Traced on the GLM 5.3 Flash suite (2026-10-10). A goal declared before its tool ran
// guessed the result's shape — `evidence.json_field:recipients.length:1` for an SMS
// compose that returns `recipientCount`, `clipboard.text` for a clipboard read that
// returns `text`. The work succeeded; the criterion could never match; blocking criteria
// are monotonic, so it could not be corrected; and the hint said to "write
// recipients.length with write_file", which sent the model fabricating JSON files. Both
// runs ended blocked with the work done. The predicate below is how the graph tells a
// criterion naming a field no result carries from one the work has not met yet.

const SMS_RESULT =
  'sms_compose:{"status":"sms_composer_opened","recipientCount":1,"messageLength":26}';
const CLIPBOARD_RESULT = 'clipboard_read:{"status":"read","text":"SPA-DIRECT-CLIP-42"}';
const CONTACTS_RESULT = 'contacts_search:[{"id":"e2e-contact-avery","name":"Avery Chen"}]';

describe('a json_field criterion read against the results a goal holds', () => {
  it('knows when no result carries the field', () => {
    expect(isJsonFieldAbsentFromResults('evidence.json_field:recipients.length:1', [SMS_RESULT])).toBe(
      true,
    );
    expect(
      isJsonFieldAbsentFromResults('evidence.json_field:clipboard.text:SPA-DIRECT-CLIP-42', [
        CLIPBOARD_RESULT,
      ]),
    ).toBe(true);
  });

  it('is not absent when the field is there with another value', () => {
    expect(isJsonFieldAbsentFromResults('evidence.json_field:recipientCount:2', [SMS_RESULT])).toBe(
      false,
    );
  });

  it('is not absent before any result exists, since the field may still arrive', () => {
    expect(isJsonFieldAbsentFromResults('evidence.json_field:recipientCount:1', [])).toBe(false);
    expect(
      isJsonFieldAbsentFromResults('evidence.json_field:recipientCount:1', [
        'sms_compose:observed_result:call-sms',
      ]),
    ).toBe(false);
  });

  it('reads a list result the way the criterion does, first entry included', () => {
    expect(isJsonFieldAbsentFromResults('evidence.json_field:id:e2e-contact-avery', [CONTACTS_RESULT])).toBe(
      false,
    );
  });

});

