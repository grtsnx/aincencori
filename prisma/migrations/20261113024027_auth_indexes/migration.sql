-- CreateIndex
CREATE INDEX "account_providerId_accountId_idx" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "invitation_inviterId_idx" ON "invitation"("inviterId");

-- CreateIndex
CREATE INDEX "member_organizationId_userId_idx" ON "member"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "oauthClientAssertion_expiresAt_idx" ON "oauthClientAssertion"("expiresAt");
