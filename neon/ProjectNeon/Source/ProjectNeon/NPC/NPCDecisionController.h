#pragma once

#include "CoreMinimal.h"
#include "AIController.h"
#include "Core/NeonTypes.h"
#include "NPC/NeonNPC.h"
#include "NPCDecisionController.generated.h"

/**
 * The NPC's brain.
 *  1. Utility AI scores competing options: the schedule's proposal, needs (hunger, energy,
 *     social, fun), money, emotional state, and reactions to perceived events.
 *  2. For nearby (tier 1) NPCs reacting to a significant event, the language model may be
 *     asked for a high-level proposal; it is accepted only if it is one of the allowed actions
 *     and the event is still current — the game's rules always have the final say.
 *  3. The chosen activity is executed as a small state machine (walk the sidewalk graph,
 *     enter buildings, chat, investigate, flee, call for help, confront).
 * Update rate drops with simulation tier, and tier-3 NPCs move abstractly (no physics).
 */
UCLASS()
class PROJECTNEON_API ANPCDecisionController : public AAIController
{
	GENERATED_BODY()
public:
	ANPCDecisionController();
	virtual void Tick(float DeltaSeconds) override;

	FNeonDecision Current;
	FString LastReason;
	bool InvitedToChat(ANeonNPC* From);
	ANeonNPC* GetNPC() const { return Cast<ANeonNPC>(GetPawn()); }

private:
	TArray<FVector> Path;
	int32 PathIdx = 0;
	float DecideTimer = 0.f;
	float ActivityTime = 0.f;
	float StuckTime = 0.f;
	bool bArrived = false;
	TWeakObjectPtr<ANeonNPC> Partner;
	float ChatTimer = 0.f;
	bool bChatLeader = false;
	FNeonWorldEvent ReactingTo;
	TSet<FString> HandledEvents;
	double LastLLMRequest = -1000.0;

	void Decide();
	void Commit(const FNeonDecision& D);
	void Execute(float Dt);
	bool MoveAlong(float Dt, float Speed);
	void SetGoal(const FVector& Target);
	void ArriveAtPlace();
	void Finish();

	FNeonDecision ScheduleOption() const;
	bool ReactionOption(FNeonDecision& Out);
	void RequestModelDecision(const ANeonNPC::FStimulus& S);
	void SocialExchange(ANeonNPC* Speaker, ANeonNPC* Listener);
	static ENeonActivity ActivityFromAction(const FString& Action);
};
