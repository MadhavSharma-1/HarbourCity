#include "AI/NeonRuleDialogue.h"
#include "AI/NeonMemoryLogic.h"
#include "NPC/NeonNPC.h"
#include "NPC/NPCIdentityComponent.h"
#include "NPC/NPCEmotionComponent.h"
#include "NPC/NPCNeedsComponent.h"
#include "NPC/NPCRelationshipComponent.h"
#include "NPC/NPCMemoryComponent.h"
#include "Core/NeonSimSubsystem.h"

namespace
{
	bool HasAny(const FString& Text, std::initializer_list<const TCHAR*> Words)
	{
		for (const TCHAR* W : Words) if (Text.Contains(W)) return true;
		return false;
	}
	FString Pick(std::initializer_list<const TCHAR*> Options)
	{
		const int32 N = (int32)Options.size();
		return FString(*(Options.begin() + FMath::RandRange(0, N - 1)));
	}
	FString LowerFirst(const FString& S) { return S.IsEmpty() ? S : S.Left(1).ToLower() + S.Mid(1); }
	FString StripDot(FString S) { S.TrimEndInline(); if (S.EndsWith(TEXT("."))) S.LeftChopInline(1); return S; }
}

FString NeonRuleDialogue::Directions(const FVector& From, const FVector& To)
{
	const FVector D = To - From;
	const float Dist = D.Size2D() / 100.f;
	if (Dist < 25.f) return TEXT("right here");
	static const TCHAR* Names[] = { TEXT("north"), TEXT("north-east"), TEXT("east"), TEXT("south-east"), TEXT("south"), TEXT("south-west"), TEXT("west"), TEXT("north-west") };
	float Ang = FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X)); if (Ang < 0) Ang += 360.f;
	const int32 Idx = FMath::RoundToInt(Ang / 45.f) % 8;
	return FString::Printf(TEXT("about %d metres %s of here"), FMath::RoundToInt(Dist / 10.f) * 10, Names[Idx]);
}

FString NeonRuleDialogue::TellMemory(const ANeonNPC* NPC, const FNeonMemory& M, double Now)
{
	const FString When = NeonTime::Ago(Now, M.GameTime);
	const FString What = StripDot(LowerFirst(M.Summary));
	const bool bUnsure = M.Confidence < 0.55f;
	switch (M.Source)
	{
	case ENeonInfoSource::ToldBy:
	{
		FString Who = TEXT("someone");
		if (const UWorld* W = NPC->GetWorld())
			if (const UNeonSimSubsystem* Sim = W->GetSubsystem<UNeonSimSubsystem>())
				if (const ANeonNPC* Src = Sim->FindNPC(M.SourceNpc)) Who = Src->Identity->FirstName;
		return FString::Printf(TEXT("%s told me %s. I didn't see it myself though."), *Who, *What);
	}
	case ENeonInfoSource::Heard:
		return FString::Printf(TEXT("I heard %s %s, but I didn't see what happened."), *What, *When);
	case ENeonInfoSource::Self:
		return FString::Printf(TEXT("%s."), *M.Summary.Replace(TEXT("."), TEXT("")));
	default:
		return FString::Printf(TEXT("%s%s, %s."), bUnsure ? TEXT("I think ") : TEXT(""), *(bUnsure ? What : M.Summary.Left(1) + What.Mid(1)), *When);
	}
}

FNeonDialogueResult NeonRuleDialogue::Respond(ANeonNPC* NPC, const FString& Line, const TArray<FNeonMemory>& Recalled)
{
	FNeonDialogueResult R;
	R.Provider = TEXT("rules");
	const FString T = Line.ToLower();
	const FNeonPersonality& P = NPC->Identity->Personality;
	const FNeonRelationship* Rel = NPC->Relationships->Find(NeonNames::Player);
	const float Aff = Rel ? Rel->Affinity : 0.f;
	const bool bHostile = Aff < -0.4f || NPC->Emotion->Anger > 0.6f;
	const UNeonSimSubsystem* Sim = NPC->GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	const double Now = Sim ? Sim->GameHours : 0.0;
	const bool bMet = Rel && Rel->Familiarity > 0.05f;

	// relevance-filtered memories (ignore ones that only matched by recency)
	const TArray<FString> Q = NeonMemoryLogic::Tokenize(Line);
	TArray<FNeonMemory> Relevant = Recalled.FilterByPredicate([&](const FNeonMemory& M) { return NeonMemoryLogic::Relevance(Q, M) > 0.f && M.EventType != ENeonEventType::Conversation; });

	// insults
	if (HasAny(T, { TEXT("idiot"), TEXT("stupid"), TEXT("shut up"), TEXT("get lost"), TEXT("loser"), TEXT("ugly"), TEXT("moron"), TEXT("out of my way") }))
	{
		R.AffinityDelta = -0.25f; R.TrustDelta = -0.1f; R.ValenceDelta = -0.3f; R.ArousalDelta = 0.3f;
		R.bHasMemory = true; R.MemorySummary = TEXT("The player insulted me."); R.MemoryImportance = 0.55f; R.MemoryTags = { TEXT("insult"), TEXT("rude") };
		if (P.Aggression > 0.55f || P.Confidence > 0.7f) { R.Reply = Pick({ TEXT("Excuse me? Watch your mouth."), TEXT("Say that again. I dare you."), TEXT("Wow. Real nice. Get away from me.") }); R.Intent = TEXT("refuse"); }
		else { R.Reply = Pick({ TEXT("Okay... I'm going."), TEXT("I don't want any trouble."), TEXT("Fine. Whatever.") }); R.Intent = TEXT("end_conversation"); }
		return R;
	}
	if (HasAny(T, { TEXT("bye"), TEXT("see you"), TEXT("later"), TEXT("gotta go"), TEXT("take care") }))
	{
		R.Intent = TEXT("end_conversation");
		R.Reply = bHostile ? TEXT("Yeah. Bye.") : Aff > 0.3f ? Pick({ TEXT("See you around! Take care."), TEXT("Bye! Good talking to you.") }) : Pick({ TEXT("Later."), TEXT("See you.") });
		return R;
	}
	if (HasAny(T, { TEXT("thank"), TEXT("cheers"), TEXT("appreciate") }))
	{
		R.Reply = bHostile ? TEXT("Mm.") : Pick({ TEXT("No problem."), TEXT("Anytime."), TEXT("Sure thing.") });
		R.AffinityDelta = 0.05f; R.Intent = TEXT("small_talk");
		return R;
	}
	if (HasAny(T, { TEXT("sorry"), TEXT("apolog") }))
	{
		const bool bForgive = P.Empathy * 0.6f + P.Friendliness * 0.4f > 0.45f;
		R.Reply = bForgive ? TEXT("...Alright. Apology accepted. Just be more careful.") : TEXT("Sorry doesn't fix it.");
		R.AffinityDelta = bForgive ? 0.25f : 0.05f; R.TrustDelta = bForgive ? 0.1f : 0.f; R.Intent = TEXT("answer");
		R.bHasMemory = true; R.MemorySummary = TEXT("The player apologised to me."); R.MemoryImportance = 0.5f; R.MemoryTags = { TEXT("apology") };
		return R;
	}
	// the player shares news (stolen car, accident...)
	if (HasAny(T, { TEXT("stole"), TEXT("stolen"), TEXT("robbed"), TEXT("took my"), TEXT("crashed into"), TEXT("hit my") }))
	{
		R.bHasMemory = true; R.MemorySummary = FString::Printf(TEXT("The player told me: \"%s\""), *Line.Left(160)); R.MemoryImportance = 0.55f;
		R.MemoryTags = NeonMemoryLogic::Tokenize(Line); if (R.MemoryTags.Num() > 8) R.MemoryTags.SetNum(8);
		if (bHostile) { R.Reply = TEXT("Not my problem."); R.Intent = TEXT("refuse"); return R; }
		R.Reply = P.Empathy > 0.5f ? TEXT("Seriously? That's awful. I'd report it — the city has an emergency line, and people around here notice things.")
			: TEXT("That's rough. Can't help you there, though.");
		R.AffinityDelta = 0.05f;
		return R;
	}
	// questions about what they've seen
	const bool bAskSeen = HasAny(T, { TEXT("seen"), TEXT("see "), TEXT("saw"), TEXT("notice"), TEXT("witness"), TEXT("what happened"), TEXT("hear about"), TEXT("heard") });
	if (bAskSeen)
	{
		if (bHostile && P.Honesty < 0.5f) { R.Reply = TEXT("Even if I had, why would I tell you?"); R.Intent = TEXT("refuse"); return R; }
		if (Relevant.Num() > 0)
		{
			const FNeonMemory& M = Relevant[0];
			R.Reply = TellMemory(NPC, M, Now) + (P.Curiosity > 0.6f ? TEXT(" Why do you ask?") : TEXT(""));
			R.CitedMemoryIds.Add(M.Id);
			R.Intent = P.Curiosity > 0.6f ? TEXT("ask_back") : TEXT("answer");
			R.AffinityDelta = 0.02f;
		}
		else
		{
			R.Reply = Pick({ TEXT("No, sorry. I haven't seen anything like that."), TEXT("Can't say I have."), TEXT("Nope. I've been minding my own business.") });
			R.Intent = TEXT("answer");
		}
		R.bHasMemory = true; R.MemorySummary = FString::Printf(TEXT("The player asked me: \"%s\""), *Line.Left(140)); R.MemoryImportance = 0.42f;
		R.MemoryTags = Q; if (R.MemoryTags.Num() > 8) R.MemoryTags.SetNum(8);
		return R;
	}
	// directions
	if (Sim && HasAny(T, { TEXT("where"), TEXT("how do i get"), TEXT("nearest"), TEXT("looking for") }))
	{
		struct FKey { const TCHAR* Word; ENeonPlaceType Type; };
		static const FKey Keys[] = { { TEXT("gas"), ENeonPlaceType::GasStation }, { TEXT("fuel"), ENeonPlaceType::GasStation }, { TEXT("petrol"), ENeonPlaceType::GasStation },
			{ TEXT("coffee"), ENeonPlaceType::Cafe }, { TEXT("cafe"), ENeonPlaceType::Cafe }, { TEXT("eat"), ENeonPlaceType::Restaurant }, { TEXT("food"), ENeonPlaceType::Restaurant },
			{ TEXT("restaurant"), ENeonPlaceType::Restaurant }, { TEXT("shop"), ENeonPlaceType::Shop }, { TEXT("store"), ENeonPlaceType::Shop }, { TEXT("market"), ENeonPlaceType::Shop },
			{ TEXT("park"), ENeonPlaceType::Park }, { TEXT("job"), ENeonPlaceType::JobCenter } };
		for (const FKey& K : Keys)
		{
			if (!T.Contains(K.Word)) continue;
			if (const FNeonPlace* Pl = Sim->NearestPlace(K.Type, NPC->GetActorLocation(), false))
			{
				R.Reply = FString::Printf(TEXT("%s? It's %s.%s"), *Pl->DisplayName, *Directions(NPC->GetActorLocation(), Pl->Entrance),
					Pl->IsOpenAt(Sim->HourOfDay()) ? TEXT("") : TEXT(" Probably closed right now, though."));
				R.Intent = TEXT("answer"); R.AffinityDelta = 0.03f;
				return R;
			}
		}
		R.Reply = TEXT("Hmm, not sure what you mean. What are you looking for?"); R.Intent = TEXT("ask_back");
		return R;
	}
	// about them
	if (HasAny(T, { TEXT("what do you do"), TEXT("your job"), TEXT("work"), TEXT("what are you up to"), TEXT("doing") }))
	{
		const FString Act = NeonTime::ActivityName(NPC->CurrentActivity);
		if (!NPC->Needs->bEmployed) R.Reply = FString::Printf(TEXT("Honestly? I lost my job recently. I'm %s. Money's tight."), *Act);
		else
		{
			FString Employer;
			if (Sim) if (const FNeonPlace* W = Sim->FindPlace(NPC->Identity->WorkPlace)) Employer = W->DisplayName;
			R.Reply = FString::Printf(TEXT("I'm a %s%s. Right now I'm %s."), *NPC->Identity->Occupation, Employer.IsEmpty() ? TEXT("") : *(TEXT(" at ") + Employer), *Act);
		}
		R.Intent = TEXT("answer"); R.AffinityDelta = 0.04f;
		return R;
	}
	if (HasAny(T, { TEXT("how are you"), TEXT("how's it going"), TEXT("how are things"), TEXT("you okay"), TEXT("how you doing") }))
	{
		const FString Mood = NPC->Emotion->Describe();
		FString Detail;
		if (!NPC->Needs->bEmployed) Detail = TEXT(" Job hunting is wearing me down.");
		else if (NPC->Needs->Energy < 0.3f) Detail = TEXT(" Tired, mostly.");
		else if (NPC->Needs->Hunger < 0.3f) Detail = TEXT(" Starving, actually.");
		else if (NPC->Emotion->Fear > 0.3f) Detail = TEXT(" Still a bit shaken, to be honest.");
		R.Reply = bHostile ? TEXT("Better before you showed up.") : FString::Printf(TEXT("I'm %s.%s"), *Mood, *Detail);
		R.Intent = TEXT("small_talk"); R.AffinityDelta = bHostile ? 0.f : 0.05f; R.ValenceDelta = 0.05f;
		return R;
	}
	// greetings / anything else: small talk, maybe gossip
	if (bHostile) { R.Reply = Pick({ TEXT("What do you want?"), TEXT("I'm busy."), TEXT("Make it quick.") }); R.Intent = TEXT("refuse"); return R; }
	const TArray<FNeonMemory> News = NPC->Memory->Shareable(1, Now - 24.0);
	if (News.Num() > 0 && P.Sociability > 0.45f && FMath::FRand() < 0.6f)
	{
		R.Reply = (bMet ? TEXT("Hey again. ") : TEXT("Hi. ")) + FString(TEXT("Did you hear? ")) + TellMemory(NPC, News[0], Now);
		R.CitedMemoryIds.Add(News[0].Id);
	}
	else if (!bMet)
	{
		R.Reply = P.Friendliness > 0.6f ? FString::Printf(TEXT("Hi there! I'm %s. Don't think we've met."), *NPC->Identity->FirstName)
			: P.Friendliness < 0.3f ? FString(TEXT("Can I help you?")) : FString::Printf(TEXT("Hey. I'm %s."), *NPC->Identity->FirstName);
	}
	else R.Reply = Pick({ TEXT("Good to see you again."), TEXT("Oh, hey. What's up?"), TEXT("Back again? What's going on?") });
	R.Intent = TEXT("small_talk"); R.AffinityDelta = 0.03f;
	return R;
}
