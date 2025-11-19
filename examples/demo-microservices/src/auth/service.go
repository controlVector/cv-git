// Authentication Service - Go
// Handles user authentication, token generation and verification

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// User represents an authenticated user
type User struct {
	ID       string
	Username string
	Email    string
	Role     string
}

// Token represents an authentication token
type Token struct {
	Value     string
	UserID    string
	ExpiresAt time.Time
	IssuedAt  time.Time
}

// AuthService handles authentication operations
type AuthService struct {
	users  map[string]User
	tokens map[string]Token
}

// NewAuthService creates a new authentication service
func NewAuthService() *AuthService {
	return &AuthService{
		users:  make(map[string]User),
		tokens: make(map[string]Token),
	}
}

// Authenticate verifies user credentials and returns a token
func (s *AuthService) Authenticate(username, password string) (*Token, error) {
	user, exists := s.findUserByUsername(username)
	if !exists {
		return nil, errors.New("user not found")
	}

	if !s.verifyPassword(password, user.ID) {
		return nil, errors.New("invalid password")
	}

	token := s.generateToken(user.ID)
	s.tokens[token.Value] = token

	return &token, nil
}

// VerifyToken checks if a token is valid
func (s *AuthService) VerifyToken(tokenValue string) (*User, error) {
	token, exists := s.tokens[tokenValue]
	if !exists {
		return nil, errors.New("invalid token")
	}

	if time.Now().After(token.ExpiresAt) {
		delete(s.tokens, tokenValue)
		return nil, errors.New("token expired")
	}

	user, exists := s.users[token.UserID]
	if !exists {
		return nil, errors.New("user not found")
	}

	return &user, nil
}

// RegisterUser adds a new user to the system
func (s *AuthService) RegisterUser(username, email, password string) (*User, error) {
	if _, exists := s.findUserByUsername(username); exists {
		return nil, errors.New("username already exists")
	}

	userID := s.generateUserID(username)
	user := User{
		ID:       userID,
		Username: username,
		Email:    email,
		Role:     "user",
	}

	s.users[userID] = user
	return &user, nil
}

// RevokeToken invalidates a token
func (s *AuthService) RevokeToken(tokenValue string) error {
	if _, exists := s.tokens[tokenValue]; !exists {
		return errors.New("token not found")
	}

	delete(s.tokens, tokenValue)
	return nil
}

// Helper functions

func (s *AuthService) findUserByUsername(username string) (User, bool) {
	for _, user := range s.users {
		if user.Username == username {
			return user, true
		}
	}
	return User{}, false
}

func (s *AuthService) verifyPassword(password, userID string) bool {
	// Simplified password verification
	hashedPassword := s.hashPassword(password)
	// In real implementation, would compare with stored hash
	return len(hashedPassword) > 0
}

func (s *AuthService) hashPassword(password string) string {
	hash := sha256.Sum256([]byte(password))
	return hex.EncodeToString(hash[:])
}

func (s *AuthService) generateToken(userID string) Token {
	tokenValue := s.generateTokenValue(userID)
	now := time.Now()

	return Token{
		Value:     tokenValue,
		UserID:    userID,
		IssuedAt:  now,
		ExpiresAt: now.Add(24 * time.Hour),
	}
}

func (s *AuthService) generateTokenValue(userID string) string {
	data := fmt.Sprintf("%s:%d", userID, time.Now().UnixNano())
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

func (s *AuthService) generateUserID(username string) string {
	data := fmt.Sprintf("%s:%d", username, time.Now().UnixNano())
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:16])
}

// GetActiveTokens returns all active tokens for a user
// This function has higher complexity for demo purposes
func (s *AuthService) GetActiveTokens(userID string) []Token {
	var activeTokens []Token
	now := time.Now()

	for _, token := range s.tokens {
		if token.UserID == userID {
			if now.Before(token.ExpiresAt) {
				activeTokens = append(activeTokens, token)
			} else {
				// Clean up expired token
				delete(s.tokens, token.Value)
			}
		}
	}

	return activeTokens
}

// CleanupExpiredTokens removes all expired tokens
func (s *AuthService) CleanupExpiredTokens() int {
	now := time.Now()
	count := 0

	for tokenValue, token := range s.tokens {
		if now.After(token.ExpiresAt) {
			delete(s.tokens, tokenValue)
			count++
		}
	}

	return count
}

// GetUserStats returns statistics about users and tokens
// This is a complex function that might be a hotspot
func (s *AuthService) GetUserStats() map[string]interface{} {
	totalUsers := len(s.users)
	totalTokens := len(s.tokens)
	activeTokens := 0
	expiredTokens := 0
	now := time.Now()

	for _, token := range s.tokens {
		if now.Before(token.ExpiresAt) {
			activeTokens++
		} else {
			expiredTokens++
		}
	}

	roleCount := make(map[string]int)
	for _, user := range s.users {
		roleCount[user.Role]++
	}

	return map[string]interface{}{
		"total_users":    totalUsers,
		"total_tokens":   totalTokens,
		"active_tokens":  activeTokens,
		"expired_tokens": expiredTokens,
		"roles":          roleCount,
	}
}

func main() {
	service := NewAuthService()

	// Register sample user
	user, err := service.RegisterUser("demo", "demo@example.com", "password123")
	if err != nil {
		fmt.Printf("Error registering user: %v\n", err)
		return
	}

	fmt.Printf("Registered user: %s\n", user.Username)

	// Authenticate
	token, err := service.Authenticate("demo", "password123")
	if err != nil {
		fmt.Printf("Authentication failed: %v\n", err)
		return
	}

	fmt.Printf("Authentication successful, token: %s\n", token.Value)
}
