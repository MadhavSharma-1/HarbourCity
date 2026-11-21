#include "NPC/NPCDecisionController.h"
#include "NPC/NPCIdentityComponent.h"
#include "NPC/NPCMemoryComponent.h"
#include "NPC/NPCNeedsComponent.h"
#include "NPC/NPCEmotionComponent.h"
#include "NPC/NPCRelationshipComponent.h"
#include "NPC/NPCPerceptionComponent.h"
#include "NPC/NPCScheduleComponent.h"
#include "NPC/NPCDialogueComponent.h"
#include "AI/NeonAIClient.h"
#include "AI/NeonRuleDialogue.h"
#include "Core/NeonSimSubsystem.h"
#include "ProjectNeon.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

namespace
{
	const TCHAR* SmallTalk[] = {
		TEXT("Busy day?"), TEXT("Can you believe the traffic lately?"), TEXT("They're finally fixing the lights on Marlowe Street."),
		TEXT("I need a holiday."), TEXT("Have you tried the new menu at Saltwater Grill?"), TEXT("Rent went up again, you know."),
		TEXT("Nice weather for once."), TEXT("Did you see the game last night?") };
	const TCHAR* SmallTalkReply[] = {
		TEXT("Tell me about it."), TEXT("Ha, yeah."), TEXT("Honestly, same."), TEXT("No way, really?"), TEXT("I know, right?") };

	bool IsIndoorActivity(ENeonActivity A, ENeonPlaceType P)
	{
		if (P == ENeonPlaceType::Park || P == ENeonPlaceType::Street || P == ENeonPlaceType::GasStation) return false;
		switch (A)
		{
		case ENeonActivity::Sleep: case ENeonActivity::Work: case ENeonActivity::JobHunt: case ENeonActivity::Shop: case ENeonActivity::Lunch: return true;
		case ENeonActivity::Leisure: return P == ENeonPlaceType::Home || P == ENeonPlaceType::Restaurant || P == ENeonPlaceType::Cafe;
		case ENeonActivity::Commute: return P != ENeonPlaceType::Park && P != ENeonPlaceType::Street;
		default: return false;
		}
	}
}

ANPCDecisionController::ANPCDecisionController()
{
	PrimaryActorTick.bCanEverTick = true;
}

bool ANPCDecisionController::InvitedToChat(ANeonNPC* From)
{
	ANeonNPC* Me = GetNPC();
	if (!Me || Me->IsIndoors() || Me->IsKnockedDown() || Me->Dialogue->bInConversation || Current.Priority > 0.62f) return false;
	const FNeonRelationship* R = Me->Relationships->Find(From->GetNpcId());
	const float Want = Me->Identity->Personality.Sociability * 0.5f + (R ? R->Affinity * 0.4f : 0.f) + (1.f - Me->Needs->Social) * 0.3f;
	if (Want < 0.3f) return false;
	FNeonDecision D; D.Activity = ENeonActivity::Socialize; D.PartnerId = From->GetNpcId(); D.Priority = 0.55f; D.Reason = TEXT("a friend wants to chat");
	Partner = From; bChatLeader = false;
	Commit(D);
	return true;
}

void ANPCDecisionController::Tick(float Dt)
{
	Super::Tick(Dt);
	ANeonNPC* NPC = GetNPC();
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (!NPC || !Sim) return;
	NPC->SimTier = Sim->ComputeTier(NPC);
	if (NPC->IsKnockedDown()) return;

	if (NPC->Dialogue->bInConversation)
	{
		NPC->CurrentActivity = ENeonActivity::TalkToPlayer;
		if (APawn* P = UGameplayStatics::GetPlayerPawn(this, 0))
		{
			const FVector To = (P->GetActorLocation() - NPC->GetActorLocation()).GetSafeNormal2D();
			NPC->SetActorRotation(FMath::RInterpTo(NPC->GetActorRotation(), To.Rotation(), Dt, 6.f));
		}
		return;
	}
	static const float Interval[] = { 0.25f, 0.25f, 1.f, 3.f, 6.f };
	DecideTimer -= Dt;
	if (DecideTimer <= 0.f) { DecideTimer = Interval[FMath::Clamp(NPC->SimTier, 0, 4)] * FMath::FRandRange(0.8f, 1.2f); Decide(); }
	Execute(Dt);
}

FNeonDecision ANPCDecisionController::ScheduleOption() const
{
	const ANeonNPC* NPC = GetNPC();
	const UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	const FNeonScheduleEntry& E = NPC->Schedule->PlannedAt(Sim->HourOfDay(), NeonTime::Day(Sim->GameHours));
	FNeonDecision D;
	D.Activity = E.Activity;
	D.Priority = 0.5f + (E.Activity == ENeonActivity::Work ? 0.12f : 0.f) + (E.Activity == ENeonActivity::Sleep ? 0.15f : 0.f);
	D.Reason = TEXT("routine");
	const UNPCIdentityComponent* Id = NPC->Identity;
	switch (E.PlaceType)
	{
	case ENeonPlaceType::Home: D.PlaceId = Id->HomePlace; break;
	case ENeonPlaceType::Work: D.PlaceId = Id->WorkPlace; break;
	default:
		if (const FNeonPlace* P = Sim->NearestPlace(E.PlaceType, NPC->GetActorLocation(), true)) D.PlaceId = P->Id;
		else { D.PlaceId = Id->HomePlace; if (D.Activity != ENeonActivity::Commute) D.Activity = ENeonActivity::Leisure; }
	}
	// spending choices depend on money: no restaurant dinners or café lunches when money is tight
	if (const FNeonPlace* P = Sim->FindPlace(D.PlaceId))
	{
		if ((P->Type == ENeonPlaceType::Restaurant || P->Type == ENeonPlaceType::Cafe || P->Type == ENeonPlaceType::Shop) && !NPC->Needs->CanAfford(P->Price))
		{
			if (const FNeonPlace* Park = Sim->NearestPlace(ENeonPlaceType::Park, NPC->GetActorLocation(), false)) { D.PlaceId = Park->Id; D.Activity = ENeonActivity::Wander; D.Reason = TEXT("can't afford it, going for a walk"); }
			if (P->Type == ENeonPlaceType::Cafe) { D.PlaceId = Id->HomePlace; D.Activity = ENeonActivity::Lunch; D.Reason = TEXT("eating at home to save money"); }
		}
	}
	return D;
}

bool ANPCDecisionController::ReactionOption(FNeonDecision& Out)
{
	ANeonNPC* NPC = GetNPC();
	const double Now = GetWorld()->GetTimeSeconds();
	NPC->PendingStimuli.RemoveAll([&](const ANeonNPC::FStimulus& S) { return Now - S.RealTime > 25.0 || HandledEvents.Contains(S.Event.Id); });
	if (NPC->PendingStimuli.Num() == 0) return false;
	const ANeonNPC::FStimulus S = NPC->PendingStimuli.Last();
	HandledEvents.Add(S.Event.Id);
	const FNeonPersonality& P = NPC->Identity->Personality;
	const UNPCEmotionComponent* E = NPC->Emotion;
	const float Dist = S.Distance / 100.f;
	const float Sev = S.Event.Severity;
	const bool bVictim = S.Event.VictimId == NPC->GetNpcId();
	const bool bSerious = S.Event.Type == ENeonEventType::VehicleCrash || S.Event.Type == ENeonEventType::PedestrianHit || (bVictim && S.Event.Type == ENeonEventType::NearMiss);
	if (!bSerious) return false;

	struct FOpt { ENeonActivity A; float Score; const TCHAR* Why; };
	TArray<FOpt> Opts;
	Opts.Add({ ENeonActivity::Flee, (E->Fear * 0.8f + Sev * 0.3f) * (1.f - P.RiskTolerance) * (Dist < 20.f ? 1.f : 0.4f), TEXT("scared, getting away") });
	Opts.Add({ ENeonActivity::Investigate, P.Curiosity * 0.5f + P.RiskTolerance * 0.3f + P.Confidence * 0.2f - E->Fear * 0.5f, TEXT("curious, going to look") });
	if (S.Event.Type != ENeonEventType::NearMiss) Opts.Add({ ENeonActivity::CallEmergency, P.Empathy * 0.7f * Sev + (S.Event.Type == ENeonEventType::PedestrianHit ? 0.3f : 0.f), TEXT("someone may be hurt, calling for help") });
	if (bVictim && S.Event.InstigatorId == NeonNames::Player) Opts.Add({ ENeonActivity::Confront, P.Aggression * 0.6f + E->Anger * 0.5f + P.Confidence * 0.2f, TEXT("angry at the driver") });
	Opts.Add({ ENeonActivity::Idle, 0.3f + Current.Priority * 0.25f, TEXT("not my business") });
	Opts.Sort([](const FOpt& A, const FOpt& B) { return A.Score > B.Score; });
	if (Opts[0].A == ENeonActivity::Idle) return false;
	Out = FNeonDecision();
	Out.Activity = Opts[0].A;
	Out.Priority = FMath::Clamp(0.6f + Opts[0].Score * 0.4f, 0.f, 0.95f);
	Out.Reason = Opts[0].Why;
	ReactingTo = S.Event;
	if (Out.Activity == ENeonActivity::Flee)
	{
		const FVector Away = (NPC->GetActorLocation() - S.Event.Location).GetSafeNormal2D();
		Out.Target = NPC->GetActorLocation() + Away * 2500.f;
	}
	else if (Out.Activity == ENeonActivity::Investigate)
		Out.Target = S.Event.Location + (NPC->GetActorLocation() - S.Event.Location).GetSafeNormal2D() * 600.f;
	else if (Out.Activity == ENeonActivity::Confront)
		if (APawn* PP = UGameplayStatics::GetPlayerPawn(this, 0)) Out.Target = PP->GetActorLocation();
	// near, important NPCs may ask the language model for a second opinion (async, validated)
	if (NPC->SimTier == 1 && Sev >= 0.4f) RequestModelDecision(S);
	return true;
}

ENeonActivity ANPCDecisionController::ActivityFromAction(const FString& A)
{
	if (A == TEXT("investigate")) return ENeonActivity::Investigate;
	if (A == TEXT("flee")) return ENeonActivity::Flee;
	if (A == TEXT("call_emergency")) return ENeonActivity::CallEmergency;
	if (A == TEXT("confront")) return ENeonActivity::Confront;
	return ENeonActivity::Idle;
}

void ANPCDecisionController::RequestModelDecision(const ANeonNPC::FStimulus& S)
{
	ANeonNPC* NPC = GetNPC();
	UNeonAIClient* AI = GetWorld()->GetGameInstance()->GetSubsystem<UNeonAIClient>();
	const double Now = GetWorld()->GetTimeSeconds();
	if (!AI || !AI->IsAvailable() || Now - LastLLMRequest < AI->DecisionCooldownSeconds) return;
	LastLLMRequest = Now;
	const UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	TArray<FString> Allowed = { TEXT("investigate"), TEXT("flee"), TEXT("call_emergency"), TEXT("ignore") };
	if (S.Event.VictimId == NPC->GetNpcId()) Allowed.Add(TEXT("confront"));
	TSharedRef<FJsonObject> J = MakeShared<FJsonObject>();
	J->SetStringField(TEXT("npc_id"), NPC->GetNpcId().ToString());
	J->SetStringField(TEXT("name"), NPC->Identity->FullName());
	const FNeonPersonality& P = NPC->Identity->Personality;
	TSharedRef<FJsonObject> PJ = MakeShared<FJsonObject>();
	PJ->SetNumberField(TEXT("friendliness"), P.Friendliness); PJ->SetNumberField(TEXT("aggression"), P.Aggression); PJ->SetNumberField(TEXT("confidence"), P.Confidence);
	PJ->SetNumberField(TEXT("curiosity"), P.Curiosity); PJ->SetNumberField(TEXT("empathy"), P.Empathy); PJ->SetNumberField(TEXT("risk_tolerance"), P.RiskTolerance);
	J->SetObjectField(TEXT("personality"), PJ);
	TSharedRef<FJsonObject> EJ = MakeShared<FJsonObject>();
	EJ->SetNumberField(TEXT("fear"), NPC->Emotion->Fear); EJ->SetNumberField(TEXT("anger"), NPC->Emotion->Anger); EJ->SetNumberField(TEXT("stress"), NPC->Emotion->Stress);
	J->SetObjectField(TEXT("emotion"), EJ);
	J->SetStringField(TEXT("current_goal"), NeonTime::ActivityName(Current.Activity));
	J->SetStringField(TEXT("observed_event"), S.Source == ENeonInfoSource::Observed ? S.Event.Description : S.Event.SoundDescription);
	J->SetNumberField(TEXT("event_distance_m"), S.Distance / 100.f);
	J->SetStringField(TEXT("game_clock"), Sim->Clock());
	TArray<TSharedPtr<FJsonValue>> AllowedJ; for (const FString& A : Allowed) AllowedJ.Add(MakeShared<FJsonValueString>(A));
	J->SetArrayField(TEXT("allowed_actions"), AllowedJ);
	TWeakObjectPtr<ANPCDecisionController> WeakThis(this);
	const FString EventId = S.Event.Id;
	const double Sent = Now;
	AI->Post(TEXT("/v1/decide"), J, /*bHighPriority*/ false, [WeakThis, Allowed, EventId, Sent](bool bOk, TSharedPtr<FJsonObject> Body)
	{
		ANPCDecisionController* C = WeakThis.Get();
		FNeonDecisionResult R;
		if (!C || !bOk || !NeonAIValidation::ParseDecision(Body, Allowed, R)) return;
		ANeonNPC* N = C->GetNPC();
		// deterministic checks: still reacting to the same event, not too late, not busy with the player
		if (!N || N->Dialogue->bInConversation || C->ReactingTo.Id != EventId || C->GetWorld()->GetTimeSeconds() - Sent > 15.0) return;
		const ENeonActivity A = ActivityFromAction(R.Decision);
		if (A == ENeonActivity::Idle) { C->Finish(); return; }
		if (A == C->Current.Activity) return;
		FNeonDecision D = C->Current;
		D.Activity = A; D.Priority = FMath::Max(0.6f, R.Priority); D.Reason = TEXT("model: ") + R.Reason;
		if (A == ENeonActivity::Flee) D.Target = N->GetActorLocation() + (N->GetActorLocation() - C->ReactingTo.Location).GetSafeNormal2D() * 2500.f;
		if (A == ENeonActivity::Investigate) D.Target = C->ReactingTo.Location + (N->GetActorLocation() - C->ReactingTo.Location).GetSafeNormal2D() * 600.f;
		if (A == ENeonActivity::Confront) if (APawn* PP = UGameplayStatics::GetPlayerPawn(C, 0)) D.Target = PP->GetActorLocation();
		C->Commit(D);
	});
}

void ANPCDecisionController::Decide()
{
	ANeonNPC* NPC = GetNPC();
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	// 1. reactions to things this NPC perceived
	FNeonDecision React;
	if (ReactionOption(React) && React.Priority > Current.Priority) { Commit(React); return; }
	// reactive activities run to completion
	const bool bReactive = Current.Activity == ENeonActivity::Flee || Current.Activity == ENeonActivity::Investigate
		|| Current.Activity == ENeonActivity::CallEmergency || Current.Activity == ENeonActivity::Confront;
	if (bReactive) return;

	// 2. utility over routine + needs
	TArray<FNeonDecision> Options;
	Options.Add(ScheduleOption());
	const UNPCNeedsComponent* N = NPC->Needs;
	const FNeonPersonality& P = NPC->Identity->Personality;
	if (N->Hunger < 0.3f)
	{
		FNeonDecision D; D.Activity = ENeonActivity::Lunch; D.Priority = 0.55f + (0.3f - N->Hunger) * 1.5f; D.Reason = TEXT("hungry");
		const FNeonPlace* Cafe = Sim->NearestPlace(ENeonPlaceType::Cafe, NPC->GetActorLocation(), true);
		D.PlaceId = Cafe && N->CanAfford(Cafe->Price) ? Cafe->Id : NPC->Identity->HomePlace;
		Options.Add(D);
	}
	if (N->Energy < 0.15f) { FNeonDecision D; D.Activity = ENeonActivity::Sleep; D.PlaceId = NPC->Identity->HomePlace; D.Priority = 0.8f; D.Reason = TEXT("exhausted"); Options.Add(D); }
	if (N->Fun < 0.25f && Current.Activity != ENeonActivity::Work)
	{
		if (const FNeonPlace* Park = Sim->NearestPlace(ENeonPlaceType::Park, NPC->GetActorLocation(), false))
		{ FNeonDecision D; D.Activity = ENeonActivity::Wander; D.PlaceId = Park->Id; D.Priority = 0.48f; D.Reason = TEXT("needs some air"); Options.Add(D); }
	}
	if (N->Social < 0.4f && !NPC->IsIndoors() && Current.Activity != ENeonActivity::Socialize && NPC->SimTier <= 2 && Sim->HourOfDay() > 7.f && Sim->HourOfDay() < 22.f)
	{
		TArray<FName> Nearby; TMap<FName, ANeonNPC*> ById;
		for (ANeonNPC* O : Sim->GetNPCs())
			if (O != NPC && !O->IsIndoors() && FVector::Dist(O->GetActorLocation(), NPC->GetActorLocation()) < 4000.f) { Nearby.Add(O->GetNpcId()); ById.Add(O->GetNpcId(), O); }
		const FName Fav = NPC->Relationships->FavouriteAmong(Nearby);
		if (!Fav.IsNone())
		{
			FNeonDecision D; D.Activity = ENeonActivity::Socialize; D.PartnerId = Fav; D.Reason = TEXT("wants company");
			D.Priority = 0.4f + P.Sociability * 0.25f - NPC->Emotion->Stress * 0.15f;
			Options.Add(D);
		}
	}
	for (FNeonDecision& O : Options) if (O.Activity == Current.Activity && O.PlaceId == Current.PlaceId) O.Priority += 0.1f; // inertia
	Options.Sort([](const FNeonDecision& A, const FNeonDecision& B) { return A.Priority > B.Priority; });
	FNeonDecision Best = Options[0];
	if (Best.Activity == Current.Activity && Best.PlaceId == Current.PlaceId && Best.PartnerId == Current.PartnerId) { Current.Priority = Best.Priority; return; }
	if (Best.Activity == ENeonActivity::Socialize)
	{
		ANeonNPC* Other = Sim->FindNPC(Best.PartnerId);
		ANPCDecisionController* OC = Other ? Cast<ANPCDecisionController>(Other->GetController()) : nullptr;
		if (!OC || !OC->InvitedToChat(NPC)) { if (Options.Num() > 1) Best = Options[1]; else return; }
		else { Partner = Other; bChatLeader = true; }
	}
	Commit(Best);
}

void ANPCDecisionController::Commit(const FNeonDecision& D)
{
	ANeonNPC* NPC = GetNPC();
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	if (!NPC || !Sim) return;
	const bool bWasSocial = Current.Activity == ENeonActivity::Socialize;
	Current = D;
	LastReason = D.Reason;
	NPC->CurrentActivity = D.Activity;
	ActivityTime = 0.f; bArrived = false; ChatTimer = 1.5f; StuckTime = 0.f;
	if (bWasSocial && D.Activity != ENeonActivity::Socialize) Partner.Reset();
	// leave the building if the new activity happens elsewhere
	if (NPC->IsIndoors())
	{
		const FNeonPlace* Here = Sim->FindPlace(NPC->CurrentPlace);
		const bool bStay = Here && D.PlaceId == NPC->CurrentPlace && IsIndoorActivity(D.Activity, Here->Type);
		if (!bStay)
		{
			NPC->SetIndoors(false, Here ? Here->Entrance : NPC->GetActorLocation());
			NPC->CurrentPlace = NAME_None;
		}
	}
	if (NPC->IsIndoors()) { bArrived = true; Path.Reset(); return; }
	FVector Target = D.Target;
	if (const FNeonPlace* P = Sim->FindPlace(D.PlaceId)) Target = P->Entrance;
	if (D.Activity == ENeonActivity::Socialize && Partner.IsValid()) Target = Partner->GetActorLocation();
	if (D.Activity == ENeonActivity::CallEmergency) Target = NPC->GetActorLocation();
	SetGoal(Target);
}

void ANPCDecisionController::SetGoal(const FVector& Target)
{
	const ANeonNPC* NPC = GetNPC();
	const UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	Path = FVector::Dist2D(Target, NPC->GetActorLocation()) < 1500.f ? TArray<FVector>{ Target } : Sim->FindPath(NPC->GetActorLocation(), Target);
	PathIdx = 0;
}

bool ANPCDecisionController::MoveAlong(float Dt, float Speed)
{
	ANeonNPC* NPC = GetNPC();
	if (PathIdx >= Path.Num()) return true;
	FVector Loc = NPC->GetActorLocation();
	FVector Target = Path[PathIdx];
	if (FVector::Dist2D(Loc, Target) < 90.f)
	{
		if (++PathIdx >= Path.Num()) { Path.Reset(); return true; }
		Target = Path[PathIdx];
	}
	const FVector Dir = (Target - Loc).GetSafeNormal2D();
	if (NPC->SimTier >= 3)
	{
		// abstract movement for distant citizens: no physics, no animation
		const float Step = FMath::Min(Speed * Dt, (float)FVector::Dist2D(Loc, Target));
		NPC->SetActorLocation(Loc + Dir * Step);
		return false;
	}
	NPC->GetCharacterMovement()->MaxWalkSpeed = Speed;
	NPC->AddMovementInput(Dir, 1.f);
	if (NPC->GetVelocity().Size2D() < 15.f) { if ((StuckTime += Dt) > 2.5f) { NPC->SetActorLocation(Loc + Dir * 120.f, true); StuckTime = 0.f; } }
	else StuckTime = 0.f;
	return false;
}

void ANPCDecisionController::ArriveAtPlace()
{
	ANeonNPC* NPC = GetNPC();
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	FNeonPlace* P = Sim->FindPlaceMutable(Current.PlaceId);
	if (!P) return;
	// purchases: the economy sees every sale
	if ((Current.Activity == ENeonActivity::Lunch && P->Type != ENeonPlaceType::Home) || Current.Activity == ENeonActivity::Shop || (Current.Activity == ENeonActivity::Leisure && P->Type == ENeonPlaceType::Restaurant))
	{
		if (P->IsOpenAt(Sim->HourOfDay()) && NPC->Needs->Spend(P->Price))
		{
			Sim->RecordSale(P->Id, P->Price);
			if (Current.Activity != ENeonActivity::Shop) NPC->Needs->Hunger = 1.f;
			NPC->Emotion->Stimulate(0.05f, 0.f);
		}
		else if (!P->IsOpenAt(Sim->HourOfDay())) { NPC->Dialogue->Say(FString::Printf(TEXT("%s is closed? Great."), *P->DisplayName), 3.f); Finish(); return; }
	}
	if (Current.Activity == ENeonActivity::Lunch && P->Type == ENeonPlaceType::Home) NPC->Needs->Hunger = 0.85f;
	if (IsIndoorActivity(Current.Activity, P->Type))
	{
		NPC->CurrentPlace = P->Id;
		NPC->SetIndoors(true);
	}
}

void ANPCDecisionController::Finish()
{
	Current.Priority = 0.f;
	Current.Activity = ENeonActivity::Idle;
	GetNPC()->CurrentActivity = ENeonActivity::Idle;
	Path.Reset();
	DecideTimer = 0.f;
}

void ANPCDecisionController::Execute(float Dt)
{
	ANeonNPC* NPC = GetNPC();
	UNeonSimSubsystem* Sim = GetWorld()->GetSubsystem<UNeonSimSubsystem>();
	ActivityTime += Dt;
	if (NPC->IsIndoors()) return;
	const float Walk = 140.f + NPC->Identity->Personality.Confidence * 30.f - FMath::Max(0, NPC->Identity->Age - 60) * 1.5f;

	// anything scheduled "at" the park (Victor's chess tables, walks) is an outdoor stroll
	ENeonActivity Act = Current.Activity;
	if (const FNeonPlace* CP = Sim->FindPlace(Current.PlaceId))
		if (CP->Type == ENeonPlaceType::Park && (Act == ENeonActivity::Work || Act == ENeonActivity::Leisure || Act == ENeonActivity::Commute)) Act = ENeonActivity::Wander;

	switch (Act)
	{
	case ENeonActivity::Flee:
		if (MoveAlong(Dt, 480.f) || ActivityTime > 12.f) Finish();
		break;
	case ENeonActivity::Investigate:
		if (!bArrived && (MoveAlong(Dt, 220.f) || ActivityTime > 25.f))
		{
			bArrived = true; ActivityTime = 0.f;
			// now close enough to actually see it
			if (NPC->Perception->CanSee(ReactingTo.Location, ReactingTo.Instigator.Get(), 2000.f))
			{
				UNPCMemoryComponent::FParams M;
				M.Type = ReactingTo.Type; M.EventId = ReactingTo.Id; M.Summary = ReactingTo.Description; M.Tags = ReactingTo.Tags;
				M.Importance = 0.7f; M.Source = ENeonInfoSource::Observed; M.Location = ReactingTo.Location;
				NPC->Memory->Remember(M); // upgrades a "heard" memory to an observed one
				NPC->Dialogue->Say(NPC->Identity->Personality.Empathy > 0.6f ? TEXT("Is everyone okay?!") : TEXT("Whoa. That's bad."), 3.f);
			}
		}
		if (bArrived)
		{
			NPC->SetActorRotation(FMath::RInterpTo(NPC->GetActorRotation(), (ReactingTo.Location - NPC->GetActorLocation()).GetSafeNormal2D().Rotation(), Dt, 4.f));
			if (ActivityTime > 8.f) Finish();
		}
		break;
	case ENeonActivity::CallEmergency:
		if (ActivityTime < Dt * 1.5f) NPC->Dialogue->Say(FString::Printf(TEXT("Hello, emergency? There's been an accident %s. Please send someone."), *Sim->PlaceNameAt(ReactingTo.Location)), 6.f);
		if (ActivityTime > 7.f)
		{
			FNeonWorldEvent Report = ReactingTo;
			Report.Description = FString::Printf(TEXT("%s reported: %s"), *NPC->Identity->FullName(), *ReactingTo.Description);
			Sim->EmergencyReports.Add(Report);
			UNPCMemoryComponent::FParams M;
			M.Type = ENeonEventType::EmergencyCall; M.Source = ENeonInfoSource::Self; M.Summary = FString::Printf(TEXT("Called emergency services about %s."), *ReactingTo.Description.ToLower());
			M.Tags = ReactingTo.Tags; M.Tags.Add(TEXT("called")); M.Tags.Add(TEXT("emergency")); M.Importance = 0.65f;
			NPC->Memory->Remember(M);
			UE_LOG(LogNeon, Log, TEXT("[emergency] %s"), *Report.Description);
			Finish();
		}
		break;
	case ENeonActivity::Confront:
	{
		APawn* PP = UGameplayStatics::GetPlayerPawn(this, 0);
		if (!PP || ActivityTime > 14.f) { Finish(); break; }
		const float D = FVector::Dist2D(PP->GetActorLocation(), NPC->GetActorLocation());
		if (D > 3500.f) { Finish(); break; }
		if (D > 250.f) { Path = { PP->GetActorLocation() }; PathIdx = 0; MoveAlong(Dt, 300.f); }
		else if (NPC->Dialogue->LineTimeLeft <= 0.f)
		{
			static const TCHAR* Lines[] = { TEXT("Hey! You almost killed me!"), TEXT("What's wrong with you?!"), TEXT("I saw what you did. I'll remember your face."), TEXT("Learn to drive!") };
			NPC->Dialogue->Say(Lines[FMath::RandRange(0, 3)], 3.f);
		}
		break;
	}
	case ENeonActivity::Socialize:
	{
		ANeonNPC* O = Partner.Get();
		if (!O || O->IsIndoors() || ActivityTime > 60.f) { if (O) O->Needs->Social = FMath::Max(O->Needs->Social, 0.6f); NPC->Needs->Social = FMath::Max(NPC->Needs->Social, 0.7f); Finish(); break; }
		const float D = FVector::Dist2D(O->GetActorLocation(), NPC->GetActorLocation());
		if (D > 220.f) { if (Path.Num() == 0 || FVector::Dist2D(Path.Last(), O->GetActorLocation()) > 300.f) SetGoal(O->GetActorLocation()); MoveAlong(Dt, Walk); }
		else
		{
			NPC->SetActorRotation(FMath::RInterpTo(NPC->GetActorRotation(), (O->GetActorLocation() - NPC->GetActorLocation()).GetSafeNormal2D().Rotation(), Dt, 5.f));
			if (bChatLeader && (ChatTimer -= Dt) <= 0.f) { ChatTimer = 5.f; SocialExchange(FMath::RandBool() ? NPC : O, nullptr); }
		}
		break;
	}
	case ENeonActivity::Wander:
	case ENeonActivity::Leisure:
	{
		const FNeonPlace* P = Sim->FindPlace(Current.PlaceId);
		if (P && (P->Type == ENeonPlaceType::Park || P->Type == ENeonPlaceType::Street))
		{
			if (MoveAlong(Dt, Walk * 0.8f))
			{
				// stroll between random points in the park, pausing now and then
				SetGoal(P->Center + FVector(FMath::FRandRange(-1800.f, 1800.f), FMath::FRandRange(-1800.f, 1800.f), 0));
			}
			break;
		}
		if (!bArrived && MoveAlong(Dt, Walk)) { bArrived = true; ArriveAtPlace(); }
		break;
	}
	case ENeonActivity::Idle:
	case ENeonActivity::TalkToPlayer:
		break;
	default:
		if (!bArrived && MoveAlong(Dt, Current.Activity == ENeonActivity::Commute ? Walk * 1.1f : Walk)) { bArrived = true; ArriveAtPlace(); }
		break;
	}
}

void ANPCDecisionController::SocialExchange(ANeonNPC* Speaker, ANeonNPC*)
{
	ANeonNPC* A = Speaker;
	ANeonNPC* B = (A == GetNPC()) ? Partner.Get() : GetNPC();
	if (!A || !B) return;
	const double Now = A->Memory->Now();
	FNeonRelationship& RAB = A->Relationships->Get(B->GetNpcId());
	const FNeonPersonality& PA = A->Identity->Personality;
	const FNeonPersonality& PB = B->Identity->Personality;
	auto Both = [&](float DAff, float DTrust, float DFam)
	{
		A->Relationships->Adjust(B->GetNpcId(), DAff, DTrust, DFam, Now);
		B->Relationships->Adjust(A->GetNpcId(), DAff, DTrust, DFam, Now);
	};
	auto Shared = [&](ENeonEventType T, const FString& Summary, float Imp)
	{
		for (ANeonNPC* X : { A, B })
		{
			UNPCMemoryComponent::FParams M; M.Type = T; M.Summary = Summary; M.Importance = Imp; M.Source = ENeonInfoSource::Self;
			M.Participants = { A->GetNpcId(), B->GetNpcId() }; M.Tags = { A->Identity->FirstName.ToLower(), B->Identity->FirstName.ToLower() };
			X->Memory->Remember(M);
		}
	};
	// arguments between abrasive people who don't get on
	if ((PA.Aggression > 0.6f || PB.Aggression > 0.6f) && RAB.Affinity < -0.1f && FMath::FRand() < 0.35f)
	{
		A->Dialogue->Say(TEXT("You know what, you always do this."), 3.f);
		B->Dialogue->Say(TEXT("Me?! Unbelievable. I'm done."), 3.f);
		Both(-0.2f, -0.1f, 0.03f);
		A->Emotion->Stimulate(-0.3f, 0.4f, 0.f, 0.4f); B->Emotion->Stimulate(-0.3f, 0.4f, 0.f, 0.4f);
		Shared(ENeonEventType::Argument, FString::Printf(TEXT("%s and %s had an argument."), *A->Identity->FirstName, *B->Identity->FirstName), 0.6f);
		Finish();
		return;
	}
	// reconciliation after earlier conflicts
	if (RAB.Conflicts > 0 && RAB.Affinity < 0.1f && PA.Empathy > 0.55f && FMath::FRand() < 0.4f)
	{
		A->Dialogue->Say(TEXT("Hey... about the other day. I'm sorry."), 3.f);
		B->Dialogue->Say(PB.Loyalty > 0.4f ? TEXT("Thanks. Me too. Let's forget it.") : TEXT("...Okay. Apology accepted."), 3.f);
		Both(0.3f, 0.15f, 0.03f);
		Shared(ENeonEventType::Reconciled, FString::Printf(TEXT("%s and %s made up after their argument."), *A->Identity->FirstName, *B->Identity->FirstName), 0.55f);
		return;
	}
	// gossip: pass on something B doesn't know yet (information spreads only this way)
	for (const FNeonMemory& M : A->Memory->Shareable(4, Now - 72.0))
	{
		const FString Key = M.EventId.IsEmpty() ? TEXT("mem:") + M.Id : M.EventId;
		if (B->Memory->KnowsEvent(Key)) continue;
		const bool bAboutA = M.Participants.Contains(A->GetNpcId()) && (M.EventType == ENeonEventType::JobLost || M.EventType == ENeonEventType::JobFound || M.EventType == ENeonEventType::VehicleDamaged);
		FString Line = TEXT("Did you hear? ") + NeonRuleDialogue::TellMemory(A, M, Now);
		if (bAboutA)
			Line = M.EventType == ENeonEventType::JobLost ? TEXT("I lost my job. I'm still in shock, honestly.")
				: M.EventType == ENeonEventType::JobFound ? TEXT("Good news - I got a new job!") : TEXT("Someone smashed up my car. Can you believe it?");
		A->Dialogue->Say(Line, 5.f);
		UNPCMemoryComponent::FParams P;
		P.Type = M.EventType; P.EventId = Key; P.Summary = M.Summary; P.Tags = M.Tags; P.Location = M.Location; P.Participants = M.Participants;
		P.Source = ENeonInfoSource::ToldBy; P.SourceNpc = A->GetNpcId();
		P.Confidence = M.Confidence * (M.Source == ENeonInfoSource::ToldBy ? 0.7f : 0.8f) * (0.6f + 0.4f * RAB.Trust + 0.2f);
		P.Importance = M.Importance * 0.85f; P.Tier = ENeonMemoryTier::Episodic; P.GameTimeOverride = M.GameTime;
		B->Memory->Remember(P);
		if (M.EventType == ENeonEventType::JobLost && bAboutA)
		{
			B->Dialogue->Say(PB.Empathy > 0.5f ? TEXT("Oh no, I'm so sorry. If I hear about anything, I'll tell you.") : TEXT("Ouch. That's rough."), 4.f);
			Both(PB.Empathy * 0.15f, 0.08f, 0.05f);
			A->Emotion->Stimulate(0.1f, -0.05f);
		}
		else
		{
			B->Dialogue->Say(PB.Curiosity > 0.5f ? TEXT("No way! When was that?") : TEXT("Huh. Didn't know that."), 3.f);
			Both(0.03f, 0.02f, 0.04f);
		}
		return;
	}
	// plain small talk
	A->Dialogue->Say(SmallTalk[FMath::RandRange(0, UE_ARRAY_COUNT(SmallTalk) - 1)], 3.5f);
	B->Dialogue->Say(SmallTalkReply[FMath::RandRange(0, UE_ARRAY_COUNT(SmallTalkReply) - 1)], 3.f);
	Both(0.02f + (PA.Friendliness + PB.Friendliness) * 0.02f, 0.01f, 0.04f);
	A->Needs->Social = FMath::Min(1.f, A->Needs->Social + 0.08f);
	B->Needs->Social = FMath::Min(1.f, B->Needs->Social + 0.08f);
}
