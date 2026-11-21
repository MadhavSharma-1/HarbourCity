#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "AI/NeonAIClient.h"
#include "NPCDialogueComponent.generated.h"

/**
 * Conversations with the player (typed natural language) and spoken barks.
 * Builds a grounded request (identity, mood, relationship, *retrieved own memories*),
 * sends it to the AI service if available, validates the answer, and falls back to
 * NeonRuleDialogue otherwise. The outcome updates emotion, relationship and memory.
 */
UCLASS(ClassGroup = (Neon), meta = (BlueprintSpawnableComponent))
class PROJECTNEON_API UNPCDialogueComponent : public UActorComponent
{
	GENERATED_BODY()
public:
	UNPCDialogueComponent();
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;

	/** Speech bubble text (drawn by the HUD; a TTS/lip-sync layer would hook in here). */
	FString CurrentLine;
	float LineTimeLeft = 0.f;
	void Say(const FString& Text, float Seconds = 4.f);

	bool bInConversation = false;
	bool bAwaitingReply = false;
	void BeginConversation();
	void EndConversation();

	using FOnReply = TFunction<void(const FNeonDialogueResult&)>;
	void HandlePlayerLine(const FString& Text, FOnReply OnReply);

	TArray<TPair<bool, FString>> History; // bPlayer, text (last 12 turns)

private:
	TSharedRef<class FJsonObject> BuildRequest(const FString& Text, const TArray<FNeonMemory>& Recalled) const;
	void Apply(const FNeonDialogueResult& R, const FString& PlayerText);
};
