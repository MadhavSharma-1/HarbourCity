#include "AI/NeonAIClient.h"
#include "ProjectNeon.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"

bool NeonAIValidation::ParseDialogue(const TSharedPtr<FJsonObject>& J, const TSet<FString>& Known, FNeonDialogueResult& Out)
{
	if (!J.IsValid()) return false;
	FString Reply;
	if (!J->TryGetStringField(TEXT("reply"), Reply)) return false;
	Reply.TrimStartAndEndInline();
	if (Reply.IsEmpty() || Reply.Len() > 400 || Reply.StartsWith(TEXT("{"))) return false;
	static const TSet<FString> Intents = { TEXT("answer"), TEXT("small_talk"), TEXT("refuse"), TEXT("ask_back"), TEXT("end_conversation"), TEXT("flee") };
	FString Intent = TEXT("answer");
	J->TryGetStringField(TEXT("intent"), Intent);
	if (!Intents.Contains(Intent)) return false;
	Out.Reply = Reply;
	Out.Intent = Intent;
	auto Num = [&](const TCHAR* K, float Lim) { double V = 0; J->TryGetNumberField(K, V); return FMath::Clamp((float)V, -Lim, Lim); };
	Out.ValenceDelta = Num(TEXT("valence_delta"), 0.5f);
	Out.ArousalDelta = Num(TEXT("arousal_delta"), 0.5f);
	Out.AffinityDelta = Num(TEXT("affinity_delta"), 0.3f);
	Out.TrustDelta = Num(TEXT("trust_delta"), 0.3f);
	const TSharedPtr<FJsonObject>* Mem = nullptr;
	if (J->TryGetObjectField(TEXT("memory_to_store"), Mem) && Mem && Mem->IsValid())
	{
		FString S;
		if ((*Mem)->TryGetStringField(TEXT("summary"), S) && !S.IsEmpty())
		{
			Out.bHasMemory = true;
			Out.MemorySummary = S.Left(240);
			double Imp = 0.4; (*Mem)->TryGetNumberField(TEXT("importance"), Imp);
			Out.MemoryImportance = FMath::Clamp((float)Imp, 0.f, 1.f);
			const TArray<TSharedPtr<FJsonValue>>* Tags = nullptr;
			if ((*Mem)->TryGetArrayField(TEXT("tags"), Tags))
				for (int32 i = 0; i < Tags->Num() && i < 8; ++i) Out.MemoryTags.Add((*Tags)[i]->AsString().ToLower().Left(32));
		}
	}
	const TArray<TSharedPtr<FJsonValue>>* Cited = nullptr;
	if (J->TryGetArrayField(TEXT("cited_memory_ids"), Cited))
		for (const TSharedPtr<FJsonValue>& V : *Cited) if (Known.Contains(V->AsString())) Out.CitedMemoryIds.Add(V->AsString());
	J->TryGetStringField(TEXT("provider"), Out.Provider);
	return true;
}

bool NeonAIValidation::ParseDecision(const TSharedPtr<FJsonObject>& J, const TArray<FString>& Allowed, FNeonDecisionResult& Out)
{
	if (!J.IsValid()) return false;
	FString D;
	if (!J->TryGetStringField(TEXT("decision"), D)) return false;
	D = D.TrimStartAndEnd().ToLower();
	bool bAcceptedByService = true;
	J->TryGetBoolField(TEXT("accepted"), bAcceptedByService);
	Out.Decision = D;
	Out.bAccepted = bAcceptedByService && Allowed.Contains(D);
	double P = 0; J->TryGetNumberField(TEXT("priority"), P);
	Out.Priority = FMath::Clamp((float)P, 0.f, 1.f);
	J->TryGetStringField(TEXT("reason"), Out.Reason);
	return Out.bAccepted;
}

void UNeonAIClient::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	CheckHealth();
}

void UNeonAIClient::CheckHealth()
{
	if (!bEnabled) return;
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(ServiceUrl + TEXT("/health"));
	Req->SetVerb(TEXT("GET"));
	Req->SetTimeout(3.f);
	TWeakObjectPtr<UNeonAIClient> WeakThis(this);
	Req->OnProcessRequestComplete().BindLambda([WeakThis](FHttpRequestPtr, FHttpResponsePtr Resp, bool bOk)
	{
		if (!WeakThis.IsValid()) return;
		WeakThis->bServiceAvailable = bOk && Resp.IsValid() && Resp->GetResponseCode() == 200;
		if (WeakThis->bServiceAvailable)
		{
			TSharedPtr<FJsonObject> J;
			if (FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Resp->GetContentAsString()), J) && J.IsValid())
				J->TryGetStringField(TEXT("provider"), WeakThis->ProviderName);
		}
		UE_LOG(LogNeon, Log, TEXT("AI service %s (%s)"), WeakThis->bServiceAvailable ? TEXT("available") : TEXT("not reachable - using local rules"), *WeakThis->ProviderName);
	});
	Req->ProcessRequest();
}

bool UNeonAIClient::Post(const FString& Path, const TSharedRef<FJsonObject>& Body, bool bHighPriority, FJsonCallback Callback)
{
	if (!IsAvailable() || ProviderName == TEXT("rules")) return false;
	if (InFlight >= MaxInFlight + (bHighPriority ? 1 : 0)) return false;
	FString Payload;
	FJsonSerializer::Serialize(Body, TJsonWriterFactory<>::Create(&Payload));
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Req = FHttpModule::Get().CreateRequest();
	Req->SetURL(ServiceUrl + Path);
	Req->SetVerb(TEXT("POST"));
	Req->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
	Req->SetContentAsString(Payload);
	Req->SetTimeout(RequestTimeoutSeconds);
	++InFlight;
	TWeakObjectPtr<UNeonAIClient> WeakThis(this);
	Req->OnProcessRequestComplete().BindLambda([WeakThis, Callback](FHttpRequestPtr, FHttpResponsePtr Resp, bool bOk)
	{
		if (WeakThis.IsValid()) WeakThis->InFlight = FMath::Max(0, WeakThis->InFlight - 1);
		TSharedPtr<FJsonObject> J;
		const bool bGood = bOk && Resp.IsValid() && Resp->GetResponseCode() == 200
			&& FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Resp->GetContentAsString()), J) && J.IsValid();
		if (!bOk && WeakThis.IsValid()) WeakThis->bServiceAvailable = false; // connection failed: stop trying until next health check
		Callback(bGood, J);
	});
	Req->ProcessRequest();
	return true;
}
