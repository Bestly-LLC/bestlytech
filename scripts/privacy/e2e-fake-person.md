End-to-end test for Vera's automatic delete (fake person only: privacy-test-4f7a21@example.com, +1 310 555 0177).
1. Snapshot: row count per privacy_data_map table, and per table the rows NOT matching the test identity.
2. Seed: waitlist_subscribers x2, contact_submissions x1, email_unsubscribe_tokens x1, email_send_log x1, agent_calls x1 (conversation_id conv_ + 26 letters/digits that does not exist), seller_intakes x1 + intake_documents x1 (file_path pointing at nothing); rg_dnc +13105550177 stays.
3. File the ticket: select maya_file_ticket('{"kind":"privacy","privacy_action":"delete","name":"Privacy Test","email":"privacy-test-4f7a21@example.com","phone":"+13105550177","source":"test"}'::jsonb);
4. Wait for the clerk to email the link (privacy_cases.token), then POST {"t": token} to /functions/v1/privacy-verify.
5. Do nothing else. The clerk tick approves, executes, emails, closes. 20 minutes later it redacts.
6. Assert: seeded rows gone or blanked, rg_dnc kept, case done + auto_approved + redacted, ticket done, email_send_log row for the address blank, every other table's non-test rows unchanged.
