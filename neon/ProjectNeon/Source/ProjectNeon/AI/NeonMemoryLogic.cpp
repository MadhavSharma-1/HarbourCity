#include "AI/NeonMemoryLogic.h"

namespace
{
	const TSet<FString>& StopWords()
	{
		static const TSet<FString> S = {
			TEXT("the"), TEXT("a"), TEXT("an"), TEXT("and"), TEXT("or"), TEXT("of"), TEXT("to"), TEXT("in"), TEXT("on"), TEXT("at"),
			TEXT("is"), TEXT("are"), TEXT("was"), TEXT("were"), TEXT("be"), TEXT("i"), TEXT("you"), TEXT("me"), TEXT("my"), TEXT("your"),
			TEXT("it"), TEXT("this"), TEXT("that"), TEXT("have"), TEXT("has"), TEXT("had"), TEXT("do"), TEXT("did"), TEXT("does"),
			TEXT("hey"), TEXT("hi"), TEXT("around"), TEXT("here"), TEXT("there"), TEXT("any"), TEXT("some"), TEXT("for"), TEXT("with"),
			TEXT("what"), TEXT("who"), TEXT("where"), TEXT("when"), TEXT("why"), TEXT("how"), TEXT("can"), TEXT("could"), TEXT("would"),
			TEXT("about"), TEXT("just"), TEXT("so"), TEXT("we"), TEXT("they"), TEXT("he"), TEXT("she"), TEXT("him"), TEXT("her"),
			TEXT("seen"), TEXT("see"), TEXT("saw"), TEXT("know"), TEXT("anything"), TEXT("someone"), TEXT("something")
		};
		return S;
	}
}

TArray<FString> NeonMemoryLogic::Tokenize(const FString& Text)
{
	TArray<FString> Out;
	FString Word;
	auto Flush = [&]()
	{
		if (Word.Len() > 1 && !StopWords().Contains(Word))
		{
			// crude stemming so "cars"/"car", "crashed"/"crash" match
			if (Word.EndsWith(TEXT("ed")) && Word.Len() > 4) Word.LeftChopInline(2);
			else if (Word.EndsWith(TEXT("s")) && Word.Len() > 3 && !Word.EndsWith(TEXT("ss"))) Word.LeftChopInline(1);
			Out.AddUnique(Word);
		}
		Word.Reset();
	};
	for (TCHAR C : Text.ToLower())
	{
		if (FChar::IsAlnum(C)) Word.AppendChar(C); else Flush();
	}
	Flush();
	return Out;
}

float NeonMemoryLogic::Relevance(const TArray<FString>& Q, const FNeonMemory& M)
{
	if (Q.Num() == 0) return 0.f;
	TArray<FString> MemTokens = Tokenize(M.Summary + TEXT(" ") + M.Place);
	for (const FString& T : M.Tags) for (const FString& Tk : Tokenize(T)) MemTokens.AddUnique(Tk);
	int32 Hits = 0;
	for (const FString& T : Q) if (MemTokens.Contains(T)) ++Hits;
	return (float)Hits / (float)Q.Num();
}

float NeonMemoryLogic::Score(const TArray<FString>& Q, const FNeonMemory& M, double Now)
{
	const double AgeHours = FMath::Max(0.0, Now - M.GameTime);
	const float Recency = (float)FMath::Exp(-AgeHours / 36.0);
	const float Rel = Relevance(Q, M);
	// without a query (e.g. "what's new?") importance and recency decide
	const float Base = Q.Num() > 0 ? 0.55f * Rel + 0.25f * M.Importance + 0.2f * Recency : 0.55f * M.Importance + 0.45f * Recency;
	return Base * (0.5f + 0.5f * M.Confidence) * (Q.Num() > 0 && Rel <= 0.f ? 0.35f : 1.f);
}

TArray<FNeonMemory> NeonMemoryLogic::Retrieve(const TArray<FNeonMemory>& All, const FString& Query, double Now, int32 MaxResults, float MinScore)
{
	const TArray<FString> Q = Tokenize(Query);
	TArray<TPair<float, int32>> Scored;
	for (int32 i = 0; i < All.Num(); ++i)
	{
		const FNeonMemory& M = All[i];
		if (M.ExpiresAt >= 0.0 && Now > M.ExpiresAt) continue;
		const float S = Score(Q, M, Now);
		if (S >= MinScore) Scored.Emplace(S, i);
	}
	Scored.Sort([](const TPair<float, int32>& A, const TPair<float, int32>& B) { return A.Key > B.Key; });
	TArray<FNeonMemory> Out;
	for (int32 k = 0; k < Scored.Num() && Out.Num() < MaxResults; ++k) Out.Add(All[Scored[k].Value]);
	return Out;
}

float NeonMemoryLogic::ImportanceFor(ENeonEventType Type, float Severity, bool bSelf)
{
	float Base = 0.2f;
	switch (Type)
	{
	case ENeonEventType::PedestrianHit: Base = 0.95f; break;
	case ENeonEventType::VehicleCrash: Base = 0.75f; break;
	case ENeonEventType::VehicleDamaged: Base = 0.7f; break;
	case ENeonEventType::JobLost: Base = 0.95f; break;
	case ENeonEventType::JobFound: Base = 0.85f; break;
	case ENeonEventType::NearMiss: Base = 0.6f; break;
	case ENeonEventType::Argument: Base = 0.6f; break;
	case ENeonEventType::Reconciled: Base = 0.55f; break;
	case ENeonEventType::Conversation: Base = 0.4f; break;
	case ENeonEventType::SpeedingCar: Base = 0.35f; break;
	case ENeonEventType::EmergencyCall: Base = 0.6f; break;
	case ENeonEventType::Horn: Base = 0.1f; break;
	case ENeonEventType::PlayerVehicleSeen: Base = 0.25f; break;
	case ENeonEventType::SawPlayer: Base = 0.15f; break;
	default: break;
	}
	return FMath::Clamp(Base * (0.6f + 0.6f * Severity) + (bSelf ? 0.25f : 0.f), 0.f, 1.f);
}
