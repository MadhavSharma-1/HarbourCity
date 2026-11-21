// Run in the editor: Tools > Session Frontend > Automation, filter "Neon", or from a terminal:
//   UnrealEditor ProjectNeon.uproject -ExecCmds="Automation RunTests Neon; Quit" -unattended -nullrhi -log
#include "Misc/AutomationTest.h"
#include "AI/NeonMemoryLogic.h"
#include "AI/NeonAIClient.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

#if WITH_DEV_AUTOMATION_TESTS

namespace
{
	FNeonMemory Mem(const FString& Id, const FString& Summary, double T, float Importance, TArray<FString> Tags = {}, float Confidence = 1.f)
	{
		FNeonMemory M; M.Id = Id; M.Summary = Summary; M.GameTime = T; M.Importance = Importance; M.Tags = Tags; M.Confidence = Confidence;
		return M;
	}
	TSharedPtr<FJsonObject> Parse(const FString& S)
	{
		TSharedPtr<FJsonObject> J;
		FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(S), J);
		return J;
	}
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FNeonTokenizeTest, "Neon.Memory.Tokenize", EAutomationTestFlags::ApplicationContextMask | EAutomationTestFlags::ProductFilter)
bool FNeonTokenizeTest::RunTest(const FString&)
{
	const TArray<FString> T = NeonMemoryLogic::Tokenize(TEXT("Hey, have you seen a black sports car around here?"));
	TestTrue(TEXT("keeps 'black'"), T.Contains(TEXT("black")));
	TestTrue(TEXT("stems 'sports'"), T.Contains(TEXT("sport")));
	TestTrue(TEXT("keeps 'car'"), T.Contains(TEXT("car")));
	TestFalse(TEXT("drops stop word 'seen'"), T.Contains(TEXT("seen")));
	TestFalse(TEXT("drops stop word 'you'"), T.Contains(TEXT("you")));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FNeonRetrievalTest, "Neon.Memory.RetrievalRanksRelevantFirst", EAutomationTestFlags::ApplicationContextMask | EAutomationTestFlags::ProductFilter)
bool FNeonRetrievalTest::RunTest(const FString&)
{
	const double Now = 30.0;
	TArray<FNeonMemory> All = {
		Mem(TEXT("lunch"), TEXT("Had a sandwich at Corner Bean."), 29.0, 0.2f),
		Mem(TEXT("car"), TEXT("A black sports car sped past Corner Bean."), 29.8, 0.45f, { TEXT("black"), TEXT("sports car"), TEXT("speeding") }),
		Mem(TEXT("job"), TEXT("Daniel lost his job at Lumen Labs."), 10.0, 0.95f, { TEXT("job") }),
	};
	const TArray<FNeonMemory> R = NeonMemoryLogic::Retrieve(All, TEXT("Have you seen a black sports car?"), Now, 3);
	TestTrue(TEXT("found something"), R.Num() > 0);
	if (R.Num() > 0) TestEqual(TEXT("most relevant first"), R[0].Id, FString(TEXT("car")));
	const TArray<FNeonMemory> J = NeonMemoryLogic::Retrieve(All, TEXT("Did anyone lose their job?"), Now, 1);
	if (J.Num() > 0) TestEqual(TEXT("job memory recalled"), J[0].Id, FString(TEXT("job")));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FNeonGroundingTest, "Neon.Memory.NoInventedKnowledge", EAutomationTestFlags::ApplicationContextMask | EAutomationTestFlags::ProductFilter)
bool FNeonGroundingTest::RunTest(const FString&)
{
	// an NPC who never saw a car must not retrieve a car memory
	TArray<FNeonMemory> All = { Mem(TEXT("coffee"), TEXT("Made forty lattes this morning."), 8.0, 0.2f) };
	const TArray<FNeonMemory> R = NeonMemoryLogic::Retrieve(All, TEXT("Have you seen a red truck?"), 9.0, 3);
	for (const FNeonMemory& M : R) TestTrue(TEXT("no relevance to trucks"), NeonMemoryLogic::Relevance(NeonMemoryLogic::Tokenize(TEXT("red truck")), M) == 0.f);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FNeonExpiryTest, "Neon.Memory.ExpiredMemoriesAreForgotten", EAutomationTestFlags::ApplicationContextMask | EAutomationTestFlags::ProductFilter)
bool FNeonExpiryTest::RunTest(const FString&)
{
	FNeonMemory M = Mem(TEXT("horn"), TEXT("A car honked."), 1.0, 0.9f, { TEXT("horn") });
	M.ExpiresAt = 1.5;
	const TArray<FNeonMemory> R = NeonMemoryLogic::Retrieve({ M }, TEXT("horn"), 2.0, 3);
	TestEqual(TEXT("expired memory skipped"), R.Num(), 0);
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FNeonDialogueValidationTest, "Neon.AI.DialogueValidation", EAutomationTestFlags::ApplicationContextMask | EAutomationTestFlags::ProductFilter)
bool FNeonDialogueValidationTest::RunTest(const FString&)
{
	const TSet<FString> Known = { TEXT("m1") };
	FNeonDialogueResult Ok;
	TestTrue(TEXT("valid reply accepted"), NeonAIValidation::ParseDialogue(Parse(TEXT(R"({"reply":"Yeah, about ten minutes ago.","intent":"answer","valence_delta":2,"arousal_delta":0,"affinity_delta":-5,"trust_delta":0,"memory_to_store":null,"cited_memory_ids":["m1","made-up"]})")), Known, Ok));
	TestEqual(TEXT("valence clamped"), Ok.ValenceDelta, 0.5f);
	TestEqual(TEXT("affinity clamped"), Ok.AffinityDelta, -0.3f);
	TestEqual(TEXT("unknown citation dropped"), Ok.CitedMemoryIds.Num(), 1);
	FNeonDialogueResult Bad;
	TestFalse(TEXT("unknown intent rejected"), NeonAIValidation::ParseDialogue(Parse(TEXT(R"({"reply":"ok","intent":"spawn_tank"})")), Known, Bad));
	TestFalse(TEXT("empty reply rejected"), NeonAIValidation::ParseDialogue(Parse(TEXT(R"({"reply":"   ","intent":"answer"})")), Known, Bad));
	TestFalse(TEXT("JSON-looking reply rejected"), NeonAIValidation::ParseDialogue(Parse(TEXT(R"({"reply":"{\"cmd\":1}","intent":"answer"})")), Known, Bad));
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FNeonDecisionValidationTest, "Neon.AI.DecisionValidation", EAutomationTestFlags::ApplicationContextMask | EAutomationTestFlags::ProductFilter)
bool FNeonDecisionValidationTest::RunTest(const FString&)
{
	const TArray<FString> Allowed = { TEXT("investigate"), TEXT("flee"), TEXT("ignore") };
	FNeonDecisionResult R;
	TestTrue(TEXT("allowed action"), NeonAIValidation::ParseDecision(Parse(TEXT(R"({"decision":"Investigate","priority":0.72,"reason":"Accident nearby","accepted":true})")), Allowed, R));
	TestEqual(TEXT("normalised"), R.Decision, FString(TEXT("investigate")));
	TestFalse(TEXT("disallowed action"), NeonAIValidation::ParseDecision(Parse(TEXT(R"({"decision":"open_console","priority":1,"accepted":true})")), Allowed, R));
	TestFalse(TEXT("service-rejected action"), NeonAIValidation::ParseDecision(Parse(TEXT(R"({"decision":"flee","priority":1,"accepted":false})")), Allowed, R));
	return true;
}

#endif
